import Foundation
import CoreBluetooth
import Combine

/// Manages the BLE link to the DIY MoonBoard LED controller.
///
/// The ArduinoMoonBoardLED firmware exposes a Nordic UART Service. The app writes
/// a problem string to the RX characteristic; the firmware lights the LEDs.
///
/// Message format (firmware `main.cpp`):
///   "l#" + comma-separated "<type><led>" tokens + "#"
///   e.g. "l#S0,P14,P40,E131#"   (S=start, P=move, E=end; number = 0-based LED index)
@MainActor
final class MoonBoardBLEManager: NSObject, ObservableObject {

    // Nordic UART Service UUIDs.
    static let serviceUUID = CBUUID(string: "6E400001-B5A3-F393-E0A9-E50E24DCCA9E")
    static let rxCharUUID  = CBUUID(string: "6E400002-B5A3-F393-E0A9-E50E24DCCA9E") // write (app → board)

    private static let lastDeviceKey = "lastConnectedPeripheralUUID"

    enum ConnectionState: Equatable {
        case poweredOff
        case unauthorized
        case disconnected
        case scanning
        case connecting
        case connected

        var label: String {
            switch self {
            case .poweredOff:   return "Bluetooth off"
            case .unauthorized: return "Bluetooth not authorized"
            case .disconnected: return "Disconnected"
            case .scanning:     return "Scanning…"
            case .connecting:   return "Connecting…"
            case .connected:    return "Connected"
            }
        }
    }

    /// A peripheral surfaced during scanning.
    struct DiscoveredDevice: Identifiable, Equatable {
        let id: UUID
        let name: String
        let peripheral: CBPeripheral

        static func == (lhs: DiscoveredDevice, rhs: DiscoveredDevice) -> Bool { lhs.id == rhs.id }
    }

    @Published private(set) var state: ConnectionState = .disconnected
    @Published private(set) var discovered: [DiscoveredDevice] = []
    @Published private(set) var connectedName: String?

    private var central: CBCentralManager!
    private var peripheral: CBPeripheral?
    private var writeChar: CBCharacteristic?

    /// Pending message that arrived before the characteristic was ready (e.g. user
    /// hit "Light up" mid-connect). Sent as soon as the link is ready.
    private var pendingMessage: String?

    /// Set when the user taps Disconnect, so we don't immediately auto-reconnect
    /// (auto-reconnect is only for unexpected drops). Stays set — suppressing
    /// reconnect across Bluetooth power cycles too — until the user explicitly
    /// connects again.
    private var userInitiatedDisconnect = false

    /// The firmware's RX characteristic accepts at most 20 bytes per write
    /// (BLE_ATTRIBUTE_MAX_VALUE_LENGTH in ArduinoMultiUserHardwareBLESerial). It
    /// silently truncates anything larger, which would drop emovvery hold past the
    /// first ~4. So every message MUST be split into ≤20-byte writes; the firmware
    /// reassembles them in its 256-byte receive buffer.
    private static let maxChunkLength = 20

    /// Queue of pending ≤20-byte chunks, drained with write-without-response flow
    /// control so CoreBluetooth never silently drops packets.
    private var writeQueue: [Data] = []

    /// Debounce so rapid taps in live-preview mode don't flood the link.
    private var debounceWorkItem: DispatchWorkItem?
    private let debounceInterval: TimeInterval = 0.09

    var isConnected: Bool { state == .connected }

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: .main)
    }

    // MARK: - Scanning / connecting

    func startScan() {
        guard central.state == .poweredOn else { return }
        discovered = []
        // Don't clobber a live connection: scanning to find *other* boards must
        // not flip us out of .connected (reopening the connect sheet re-scans, and
        // the UI reads this state to decide whether it's still connected).
        if !isConnected { state = .scanning }
        // Filter by the NUS service UUID so we find the board even if it was renamed.
        central.scanForPeripherals(withServices: [Self.serviceUUID], options: nil)
    }

    func stopScan() {
        central.stopScan()
        if state == .scanning { state = isConnected ? .connected : .disconnected }
    }

    func connect(_ device: DiscoveredDevice) {
        central.stopScan()
        userInitiatedDisconnect = false
        state = .connecting
        peripheral = device.peripheral
        device.peripheral.delegate = self
        central.connect(device.peripheral, options: nil)
    }

    func disconnect() {
        userInitiatedDisconnect = true
        if let p = peripheral { central.cancelPeripheralConnection(p) }
    }

    /// Try to reconnect to the last device we used, without showing a picker.
    private func attemptAutoReconnect() {
        guard !userInitiatedDisconnect,
              central.state == .poweredOn,
              let uuidString = UserDefaults.standard.string(forKey: Self.lastDeviceKey),
              let uuid = UUID(uuidString: uuidString) else { return }
        if let known = central.retrievePeripherals(withIdentifiers: [uuid]).first {
            state = .connecting
            peripheral = known
            known.delegate = self
            central.connect(known, options: nil)
        }
    }

    // MARK: - Sending

    /// Build the firmware message string for a set of holds. With beta off, the
    /// left/right/match roles all light blue (right).
    static func message(for holds: [HoldAssignment], rows: Int, flipped: Bool, showBeta: Bool) -> String {
        let tokens = holds.map { h -> String in
            let led = BoardGeometry.ledIndex(col: h.col, row: h.row, rows: rows, flipped: flipped)
            return "\(h.type.displayed(showBeta: showBeta).protocolLetter)\(led)"
        }
        return "l#" + tokens.joined(separator: ",") + "#"
    }

    /// Send a problem to the board, debounced (use for live preview while editing).
    /// `rows` is the board's row count (Mini 12, full 18) for the LED mapping.
    func sendDebounced(holds: [HoldAssignment], rows: Int, flipped: Bool, showBeta: Bool) {
        debounceWorkItem?.cancel()
        let msg = Self.message(for: holds, rows: rows, flipped: flipped, showBeta: showBeta)
        let work = DispatchWorkItem { [weak self] in self?.write(msg) }
        debounceWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + debounceInterval, execute: work)
    }

    /// Send immediately (use for the explicit "Light up on board" button).
    func send(holds: [HoldAssignment], rows: Int, flipped: Bool, showBeta: Bool) {
        debounceWorkItem?.cancel()
        write(Self.message(for: holds, rows: rows, flipped: flipped, showBeta: showBeta))
    }

    /// Turn all LEDs off (empty problem string).
    func clear() {
        debounceWorkItem?.cancel()
        write("l##")
    }

    /// Light a single LED for calibration — sent as a one-hold "move" problem.
    func lightSingleLED(_ index: Int) {
        debounceWorkItem?.cancel()
        write("l#P\(index)#")
    }

    private func write(_ message: String) {
        guard let peripheral, peripheral.state == .connected, writeChar != nil else {
            pendingMessage = message
            return
        }
        guard let data = message.data(using: .ascii) else { return }

        // Split into ≤20-byte chunks. We must NOT use maximumWriteValueLength here:
        // on modern iPhones the negotiated MTU makes it ~180+, but the firmware
        // characteristic only stores 20 bytes per write and drops the rest.
        var chunks: [Data] = []
        var offset = 0
        while offset < data.count {
            let end = min(offset + Self.maxChunkLength, data.count)
            chunks.append(data.subdata(in: offset..<end))
            offset = end
        }

        // Each message is self-contained ("l#…#"), so replace any half-sent prior one.
        writeQueue = chunks
        sendNextChunks(priming: true)
    }

    /// Send queued chunks while the link can accept write-without-response packets.
    /// Resumes from `peripheralIsReady(toSendWriteWithoutResponse:)` when throttled.
    private func sendNextChunks(priming: Bool = false) {
        guard let peripheral, let writeChar, peripheral.state == .connected else { return }
        // `canSendWriteWithoutResponse` can briefly report false right after connect;
        // prime the pump with one write so the ready-callback gets a chance to fire.
        var allowOne = priming
        while !writeQueue.isEmpty {
            if !peripheral.canSendWriteWithoutResponse && !allowOne { return }
            allowOne = false
            let chunk = writeQueue.removeFirst()
            peripheral.writeValue(chunk, for: writeChar, type: .withoutResponse)
        }
    }
}

// MARK: - CBCentralManagerDelegate

extension MoonBoardBLEManager: CBCentralManagerDelegate {
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            state = isConnected ? .connected : .disconnected
            attemptAutoReconnect()
        case .poweredOff:
            state = .poweredOff
        case .unauthorized:
            state = .unauthorized
        default:
            state = .disconnected
        }
    }

    func centralManager(_ central: CBCentralManager,
                        didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any],
                        rssi RSSI: NSNumber) {
        let name = peripheral.name
            ?? (advertisementData[CBAdvertisementDataLocalNameKey] as? String)
            ?? "MoonBoard"
        let device = DiscoveredDevice(id: peripheral.identifier, name: name, peripheral: peripheral)
        if !discovered.contains(device) { discovered.append(device) }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        UserDefaults.standard.set(peripheral.identifier.uuidString, forKey: Self.lastDeviceKey)
        connectedName = peripheral.name
        peripheral.discoverServices([Self.serviceUUID])
    }

    func centralManager(_ central: CBCentralManager,
                        didFailToConnect peripheral: CBPeripheral, error: Error?) {
        state = .disconnected
    }

    func centralManager(_ central: CBCentralManager,
                        didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        writeChar = nil
        connectedName = nil
        state = .disconnected
        // Best-effort: try to come back if the board reappears.
        attemptAutoReconnect()
    }
}

// MARK: - CBPeripheralDelegate

extension MoonBoardBLEManager: CBPeripheralDelegate {
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let service = peripheral.services?.first(where: { $0.uuid == Self.serviceUUID }) else {
            return
        }
        peripheral.discoverCharacteristics([Self.rxCharUUID], for: service)
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard let char = service.characteristics?.first(where: { $0.uuid == Self.rxCharUUID }) else {
            return
        }
        writeChar = char
        state = .connected
        if let pending = pendingMessage {
            pendingMessage = nil
            write(pending)
        }
    }

    /// CoreBluetooth signals the link can take more write-without-response packets.
    func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
        sendNextChunks()
    }
}
