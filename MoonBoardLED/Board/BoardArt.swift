import SwiftUI
import UIKit

/// Renders and caches a single flattened image of a board's *static* art — the
/// background plus its visible hold-set overlays — so a list row draws ONE image
/// instead of stacking a background + up to four transparent overlay layers.
///
/// The catalog list shows dozens of thumbnails, each previously compositing 5+
/// image layers; every row shares the same (setup, visible-set) combination, so
/// the whole list collapses to a single cached bitmap. The composite is drawn at
/// the art's native pixel size, so there's no fidelity loss versus the layered
/// path — it's the same PNGs, merged once.
enum BoardArtCache {
    private static var cache: [String: UIImage] = [:]
    private static let lock = NSLock()

    /// The flattened art for a board and the given visible hold sets (nil = all).
    /// Returns nil only if the background asset is missing, in which case callers
    /// fall back to layered rendering.
    static func image(for setup: MoonBoardSetup, visibleHoldSetIDs: Set<Int>?) -> UIImage? {
        let shown: [MoonBoardHoldSet]
        if let ids = visibleHoldSetIDs {
            shown = setup.holdSets.filter { ids.contains($0.id) }
        } else {
            shown = setup.holdSets
        }
        let overlayAssets = shown.map { setup.asset(for: $0) }
        let key = ([setup.backgroundAsset] + overlayAssets).joined(separator: "|")

        lock.lock()
        if let hit = cache[key] { lock.unlock(); return hit }
        lock.unlock()

        guard let composite = render(background: setup.backgroundAsset, overlays: overlayAssets) else {
            return nil
        }
        lock.lock()
        cache[key] = composite
        lock.unlock()
        return composite
    }

    private static func render(background: String, overlays: [String]) -> UIImage? {
        guard let bg = UIImage(named: background) else { return nil }
        let size = bg.size
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = bg.scale
        format.opaque = false
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        return renderer.image { _ in
            let rect = CGRect(origin: .zero, size: size)
            bg.draw(in: rect)
            // Overlays share the background's canvas (verified: all board art is
            // the same pixel size), so each draws into the full rect, aligned.
            for name in overlays {
                UIImage(named: name)?.draw(in: rect)
            }
        }
    }
}
