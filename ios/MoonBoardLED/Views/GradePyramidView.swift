import SwiftUI
import Charts

/// Bar chart of logged ascents by the problem's actual (consensus) grade — the
/// classic climbing "pyramid". Each bar is stacked by how many tries the ascent
/// took (flash / 2nd / 3rd / 4+), with a legend explaining the colors.
struct GradePyramidView: View {
    let ascents: [Ascent]

    /// The grade whose per-segment counts are revealed (tap a bar to select).
    @State private var selectedGrade: String?
    /// Drives the grow-up entrance animation when the chart appears.
    @State private var animateIn = false

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

    /// One ascent per distinct problem — the chart shows unique sends, not every
    /// logged repeat. Keeps the earliest send (when the problem was first done).
    /// Attempts-only logs (`sent == false`) are excluded entirely.
    private var uniqueSends: [Ascent] {
        var earliest: [String: Ascent] = [:]
        for ascent in ascents where ascent.sent && !ascent.tombstoned {
            let key = ascent.sourceCatalogID ?? "name:\(ascent.problemName)"
            if let existing = earliest[key] {
                if ascent.date < existing.date { earliest[key] = ascent }
            } else {
                earliest[key] = ascent
            }
        }
        return Array(earliest.values)
    }

    /// Counts per grade, split by try-bucket (unique sends only).
    private var counts: [String: [TryBucket: Int]] {
        var result: [String: [TryBucket: Int]] = [:]
        for ascent in uniqueSends {
            let bucket = TryBucket.from(ascent.tries)
            result[ascent.problemGrade, default: [:]][bucket, default: 0] += 1
        }
        return result
    }

    /// Grades that have at least one ascent, in canonical order.
    private var gradeDomain: [String] {
        FontGrade.all.filter { counts[$0] != nil }
    }

    private var maxTotal: Int {
        gradeDomain.map { counts[$0]?.values.reduce(0, +) ?? 0 }.max() ?? 0
    }

    private var bars: [Bar] {
        gradeDomain.flatMap { grade -> [Bar] in
            let perBucket = counts[grade] ?? [:]
            let total = perBucket.values.reduce(0, +)
            // Stacking order follows TryBucket.allCases, so the top segment is the
            // last present bucket in that order.
            let topBucket = TryBucket.allCases.last { (perBucket[$0] ?? 0) > 0 }
            return TryBucket.allCases.compactMap { bucket -> Bar? in
                guard let count = perBucket[bucket], count > 0 else { return nil }
                return Bar(grade: grade, bucket: bucket, count: count,
                           gradeTotal: total, isTop: bucket == topBucket)
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Chart(bars) { bar in
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
            .chartYScale(domain: 0...(Double(maxTotal) * 1.05 + 0.3))
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
                               tappedValue <= Double(counts[grade]?.values.reduce(0, +) ?? 0) {
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
            .chartXScale(domain: gradeDomain)
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
