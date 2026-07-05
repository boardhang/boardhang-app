import SwiftUI
import Charts

/// Bar chart of logged ascents by the problem's actual (consensus) grade — the
/// classic climbing "pyramid". Each bar is stacked by how many tries the ascent
/// took (flash / 2nd / 3rd / 4+), with a legend explaining the colors.
struct GradePyramidView: View {
    /// Pre-aggregated chart data, computed once from `ascents` (see `Model`). Held as a
    /// stored value so the many self-triggered re-renders — the 0.6 s entrance animation and
    /// each bar tap — reuse it instead of recomputing the whole chain every body pass.
    private let model: Model

    /// The grade whose per-segment counts are revealed (tap a bar to select).
    @State private var selectedGrade: String?
    /// Drives the grow-up entrance animation when the chart appears.
    @State private var animateIn = false

    init(ascents: [Ascent]) {
        self.model = Model(ascents: ascents)
    }

    private struct Bar: Identifiable {
        let grade: String
        let bucket: TryBucket
        let count: Int
        /// Total ascents at this grade (across all buckets).
        let gradeTotal: Int
        /// Whether this is the top-most segment of its bar (used to label the total).
        let isTop: Bool
        var id: String { grade + bucket.rawValue }
    }

    /// The chart's derived data — the `uniqueSends → counts → domain → bars` chain, run once
    /// per set of ascents rather than on every render.
    private struct Model {
        let bars: [Bar]
        let gradeDomain: [String]
        let maxTotal: Int
        /// Total unique sends per grade — for the tap handler's hit test.
        let gradeTotals: [String: Int]

        init(ascents: [Ascent]) {
            // One ascent per distinct problem — the chart shows unique sends, not every
            // logged repeat. Keeps the earliest send. Attempts-only logs are excluded.
            var earliest: [String: Ascent] = [:]
            for ascent in ascents where ascent.sent && !ascent.tombstoned {
                let key = ascent.sourceCatalogID ?? "name:\(ascent.problemName)"
                if let existing = earliest[key] {
                    if ascent.date < existing.date { earliest[key] = ascent }
                } else {
                    earliest[key] = ascent
                }
            }

            // Counts per grade, split by try-bucket (unique sends only).
            var counts: [String: [TryBucket: Int]] = [:]
            for ascent in earliest.values {
                let bucket = TryBucket.from(ascent.tries)
                counts[ascent.problemGrade, default: [:]][bucket, default: 0] += 1
            }

            let domain = FontGrade.all.filter { counts[$0] != nil }
            var totals: [String: Int] = [:]
            var bars: [Bar] = []
            for grade in domain {
                let perBucket = counts[grade] ?? [:]
                let total = perBucket.values.reduce(0, +)
                totals[grade] = total
                // Stacking order follows TryBucket.allCases, so the top segment is the
                // last present bucket in that order.
                let topBucket = TryBucket.allCases.last { (perBucket[$0] ?? 0) > 0 }
                for bucket in TryBucket.allCases {
                    guard let count = perBucket[bucket], count > 0 else { continue }
                    bars.append(Bar(grade: grade, bucket: bucket, count: count,
                                    gradeTotal: total, isTop: bucket == topBucket))
                }
            }

            self.bars = bars
            self.gradeDomain = domain
            self.maxTotal = domain.map { totals[$0] ?? 0 }.max() ?? 0
            self.gradeTotals = totals
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Chart(model.bars) { bar in
                BarMark(
                    x: .value("Grade", bar.grade),
                    y: .value("Ascents", animateIn ? bar.count : 0)
                )
                .foregroundStyle(by: .value("Tries", bar.bucket.rawValue))
                .opacity(selectedGrade == bar.grade ? 1 : 0.45)
                .annotation(position: .overlay) {
                    // Tapping a bar reveals each color segment's count on that bar.
                    if selectedGrade == bar.grade {
                        Text("\(bar.count)")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(.black.opacity(0.6), in: Capsule())
                    }
                }
            }
            .chartYScale(domain: 0...(Double(model.maxTotal) * 1.05 + 0.3))
            .chartOverlay { proxy in
                GeometryReader { geo in
                    Rectangle()
                        .fill(.clear)
                        .contentShape(Rectangle())
                        .gesture(SpatialTapGesture().onEnded { value in
                            guard let plotFrame = proxy.plotFrame else { return }
                            let origin = geo[plotFrame].origin
                            let x = value.location.x - origin.x
                            let y = value.location.y - origin.y
                            let tappedValue: Double = proxy.value(atY: y) ?? 0
                            let grade: String? = proxy.value(atX: x)
                            if let grade,
                               tappedValue <= Double(model.gradeTotals[grade] ?? 0) {
                                // Tapped on the bar itself → toggle that grade.
                                selectedGrade = (selectedGrade == grade) ? nil : grade
                            } else {
                                // Tapped empty space above a bar → clear.
                                selectedGrade = nil
                            }
                        })
                }
            }
            .chartForegroundStyleScale(
                domain: TryBucket.allCases.map(\.rawValue),
                range: TryBucket.allCases.map(\.color)
            )
            .chartXScale(domain: model.gradeDomain)
            .chartXAxis {
                AxisMarks { value in
                    AxisValueLabel {
                        if let grade = value.as(String.self) {
                            Text(grade).font(.caption2)
                        }
                    }
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
                    if let count = value.as(Int.self) {
                        AxisGridLine()
                        AxisValueLabel { Text("\(count)").font(.caption2) }
                    }
                }
            }
            .chartLegend(.hidden)
            .frame(height: 180)
            .padding(.top, 8)
            .onAppear {
                animateIn = false
                withAnimation(.easeOut(duration: 0.6)) { animateIn = true }
            }

            legend
        }
    }

    private var legend: some View {
        HStack(spacing: 14) {
            ForEach(TryBucket.allCases, id: \.self) { bucket in
                HStack(spacing: 5) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(bucket.color)
                        .frame(width: 11, height: 11)
                    Text(bucket.rawValue)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
