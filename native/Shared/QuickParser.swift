import Foundation

/// Capisce frasi come "dentista giovedì alle 17 #lavoro" (stesse regole della web app)
enum QuickParser {
    struct Result: Equatable {
        var title: String
        var date: Date?
        var time: String?
        var area: Area?
    }

    private static var cache: [String: NSRegularExpression] = [:]
    private static let lock = NSLock()

    private static func rx(_ p: String) -> NSRegularExpression {
        lock.lock(); defer { lock.unlock() }
        if let r = cache[p] { return r }
        let r = try! NSRegularExpression(pattern: p, options: [.caseInsensitive])
        cache[p] = r
        return r
    }

    /// Cerca la prima corrispondenza, la toglie dal testo e restituisce i gruppi catturati
    private static func take(_ pattern: String, _ text: inout String) -> [String]? {
        let ns = text as NSString
        guard let m = rx(pattern).firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) else { return nil }
        var groups: [String] = []
        for i in 0..<m.numberOfRanges {
            let r = m.range(at: i)
            groups.append(r.location == NSNotFound ? "" : ns.substring(with: r))
        }
        text = ns.replacingCharacters(in: m.range, with: " ")
        return groups
    }

    private static func pad(_ n: Int) -> String { n < 10 ? "0\(n)" : "\(n)" }
    private static func okTime(_ h: Int, _ m: Int) -> Bool { h < 24 && m < 60 }

    static func parse(_ raw: String, now: Date = Date()) -> Result {
        let cal = DateUtil.cal
        var text = " " + String(raw.prefix(300)) + " "
        var date: Date?
        var time: String?
        var area: Area?
        let y = cal.component(.year, from: now), mo = cal.component(.month, from: now)
        let yesterday = cal.startOfDay(for: DateUtil.addDays(now, -1))

        if take("\\s[#](lavoro|work|ufficio)\\b", &text) != nil { area = .lavoro }
        if take("\\s[#](personale|casa|me)\\b", &text) != nil { area = .personale }

        // Ora: "alle 15", "alle 15:30", "ore 9", "h 9.30", "15:30"
        if let g = take("\\s(?:alle|all'|ore|h)\\s?(\\d{1,2})(?:[:.](\\d{2}))?\\b", &text) {
            let h = Int(g[1]) ?? 99, m = Int(g[2]) ?? 0
            if okTime(h, m) { time = "\(pad(h)):\(pad(m))" }
        }
        if time == nil, let g = take("\\s(\\d{1,2})[:.](\\d{2})\\b", &text) {
            let h = Int(g[1]) ?? 99, m = Int(g[2]) ?? 99
            if okTime(h, m) { time = "\(pad(h)):\(pad(m))" }
        }
        if take("\\sstasera\\b", &text) != nil { date = now; if time == nil { time = "20:00" } }
        if take("\\sstamattina\\b", &text) != nil { date = now; if time == nil { time = "09:00" } }

        if take("\\sdopodomani\\b", &text) != nil { date = DateUtil.addDays(now, 2) }
        if take("\\sdomani\\b", &text) != nil { date = DateUtil.addDays(now, 1) }
        if take("\\soggi\\b", &text) != nil { date = now }
        if let g = take("\\stra\\s(\\d{1,2})\\s(giorni|giorno|settimane|settimana)\\b", &text) {
            let n = Int(g[1]) ?? 0
            date = DateUtil.addDays(now, n * (g[2].lowercased().hasPrefix("settiman") ? 7 : 1))
        }

        // Giorno della settimana: "venerdì", "sab", "il lunedì", "prossimo martedì"
        if date == nil, let g = take("\\s(?:il\\s|la\\s|prossim[oa]\\s)?(domenica|dom|luned[iì]|lun|marted[iì]|mar|mercoled[iì]|mer|gioved[iì]|gio|venerd[iì]|ven|sabato|sab)(?=\\s)", &text) {
            let w = g[1].lowercased()
            let map: [(String, Int)] = [("dom", 1), ("lun", 2), ("mar", 3), ("mer", 4), ("gio", 5), ("ven", 6), ("sab", 7)]
            if let target = map.first(where: { w.hasPrefix($0.0) })?.1 {
                var diff = (target - cal.component(.weekday, from: now) + 7) % 7
                if diff == 0 { diff = 7 }
                date = DateUtil.addDays(now, diff)
            }
        }

        // "12/11", "12/11/2026", "12-11"
        if date == nil, let g = take("\\s(\\d{1,2})[/-](\\d{1,2})(?:[/-](\\d{2,4}))?\\b", &text) {
            let d = Int(g[1]) ?? 0, m = Int(g[2]) ?? 0
            var yy = Int(g[3]) ?? y
            if yy < 100 { yy += 2000 }
            date = DateUtil.realDate(yy, m, d)
            if let dd = date, g[3].isEmpty, dd < yesterday { date = DateUtil.realDate(yy + 1, m, d) }
        }

        // "12 novembre", "il 3 dic"
        if date == nil, let g = take("\\s(?:il\\s)?(\\d{1,2})\\s(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)[a-z]*(?=\\s)", &text) {
            let d = Int(g[1]) ?? 0
            let mi = (DateUtil.months.firstIndex { $0.hasPrefix(g[2].lowercased()) } ?? 0) + 1
            date = DateUtil.realDate(y, mi, d)
            if let dd = date, dd < yesterday { date = DateUtil.realDate(y + 1, mi, d) }
        }

        // "il 15" (giorno del mese)
        if date == nil, let g = take("\\s(?:il|l')\\s?(\\d{1,2})\\b(?!\\s*[:.])", &text) {
            let d = Int(g[1]) ?? 0
            if (1...31).contains(d) {
                date = DateUtil.realDate(y, mo, d)
                if date == nil || date! < yesterday {
                    date = DateUtil.realDate(y, mo + 1, d) ?? DateUtil.realDate(y, mo + 2, d)
                }
            }
        }

        // Solo l'ora: oggi, oppure domani se l'ora è già passata
        if let t = time, date == nil {
            let p = t.split(separator: ":").compactMap { Int($0) }
            let nowMin = cal.component(.hour, from: now) * 60 + cal.component(.minute, from: now)
            date = (p[0] * 60 + p[1]) < nowMin ? DateUtil.addDays(now, 1) : now
        }

        var title = text.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        title = title.replacingOccurrences(of: "\\s(alle|ore|il|la|per)$", with: "", options: [.regularExpression, .caseInsensitive])
        title = DateUtil.capitalized(title)
        return Result(title: title, date: date.map { cal.startOfDay(for: $0) }, time: time, area: area)
    }

    /// Breve descrizione di cosa è stato capito, per l'anteprima sotto il campo di testo
    static func hint(_ raw: String) -> String? {
        let p = parse(raw)
        var bits: [String] = []
        if let d = p.date { bits.append("📅 \(DateUtil.niceDate(DateUtil.ymd(d)))") }
        if let t = p.time { bits.append("🕐 \(t)") }
        if let a = p.area { bits.append(a.label) }
        return bits.isEmpty ? nil : "Ho capito: " + bits.joined(separator: " · ")
    }
}
