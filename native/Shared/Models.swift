import Foundation

// MARK: - Tipi base (identici alla tabella "items" su Supabase e alla web app)

enum Kind: String, Codable, CaseIterable, Identifiable {
    case todo, event, note
    var id: String { rawValue }
    var label: String {
        switch self {
        case .todo: return "Da fare"
        case .event: return "Appuntamento"
        case .note: return "Appunto"
        }
    }
    var emoji: String {
        switch self {
        case .todo: return "✅"
        case .event: return "📅"
        case .note: return "📝"
        }
    }
}

enum Area: String, Codable, CaseIterable, Identifiable {
    case personale, lavoro
    var id: String { rawValue }
    var label: String { self == .lavoro ? "💼 Lavoro" : "🌷 Personale" }
}

/// Scelte di promemoria, stesse della web app
enum RemindOption: String, CaseIterable, Identifiable {
    case none, atTime = "0", m10 = "10", m30 = "30", h1 = "60", dayBefore = "1440", morning
    var id: String { rawValue }
    var label: String {
        switch self {
        case .none: return "Nessun promemoria"
        case .atTime: return "All'ora indicata"
        case .m10: return "10 minuti prima"
        case .m30: return "30 minuti prima"
        case .h1: return "1 ora prima"
        case .dayBefore: return "Il giorno prima"
        case .morning: return "Alle 9 del giorno stesso"
        }
    }
}

// MARK: - Voce (cosa da fare, appuntamento o appunto)

struct Item: Codable, Identifiable, Equatable, Hashable {
    var id: String
    var kind: Kind
    var title: String
    var body: String?
    var area: Area
    var dueDate: String?      // "yyyy-MM-dd"
    var dueTime: String?      // "HH:mm"
    var remind: String?
    var remindAt: String?     // ISO 8601
    var reminded: Bool
    var done: Bool
    var doneAt: String?
    var color: Int?
    var pinned: Bool
    var createdAt: String
    var updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id, kind, title, body, area, remind, reminded, done, color, pinned
        case dueDate = "due_date", dueTime = "due_time", remindAt = "remind_at"
        case doneAt = "done_at", createdAt = "created_at", updatedAt = "updated_at"
    }

    init(id: String = UUID().uuidString.lowercased(), kind: Kind = .todo, title: String = "", body: String? = "",
         area: Area = .personale, dueDate: String? = nil, dueTime: String? = nil, remind: String? = "auto",
         remindAt: String? = nil, reminded: Bool = false, done: Bool = false, doneAt: String? = nil,
         color: Int? = Int.random(in: 1...5), pinned: Bool = false) {
        let now = DateUtil.iso(Date())
        self.id = id; self.kind = kind; self.title = title; self.body = body; self.area = area
        self.dueDate = dueDate; self.dueTime = dueTime; self.remind = remind; self.remindAt = remindAt
        self.reminded = reminded; self.done = done; self.doneAt = doneAt; self.color = color; self.pinned = pinned
        self.createdAt = now; self.updatedAt = now
    }

    /// Decodifica tollerante: un dato strano dal server non deve mai far crashare l'app
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func str(_ k: CodingKeys) -> String? { (try? c.decodeIfPresent(String.self, forKey: k)) ?? nil }
        func bool(_ k: CodingKeys) -> Bool { ((try? c.decodeIfPresent(Bool.self, forKey: k)) ?? nil) ?? false }
        id = str(.id) ?? ""
        kind = Kind(rawValue: str(.kind) ?? "") ?? .todo
        title = str(.title) ?? ""
        body = str(.body)
        area = Area(rawValue: str(.area) ?? "") ?? .personale
        dueDate = str(.dueDate)
        dueTime = str(.dueTime)
        remind = str(.remind)
        remindAt = str(.remindAt)
        reminded = bool(.reminded)
        done = bool(.done)
        doneAt = str(.doneAt)
        color = (try? c.decodeIfPresent(Int.self, forKey: .color)) ?? nil
        pinned = bool(.pinned)
        createdAt = str(.createdAt) ?? DateUtil.iso(Date())
        updatedAt = str(.updatedAt) ?? DateUtil.iso(Date())
    }

    /// Ripulisce la voce con le stesse regole del database (lunghezze, formati, valori ammessi)
    func sanitized() -> Item? {
        guard id.range(of: #"^[A-Za-z0-9-]{1,64}$"#, options: .regularExpression) != nil else { return nil }
        var it = self
        it.title = String(title.prefix(300))
        if it.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { it.title = "(senza titolo)" }
        it.body = body.map { String($0.prefix(20000)) }
        if let d = dueDate, DateUtil.parseYmd(d) == nil { it.dueDate = nil }
        if it.dueDate == nil { it.dueTime = nil }
        if let t = dueTime, t.range(of: #"^([01]\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) == nil { it.dueTime = nil }
        if let r = remind, !(["none", "auto"] + RemindOption.allCases.map(\.rawValue)).contains(r) { it.remind = "none" }
        if DateUtil.parseIso(remindAt) == nil { it.remindAt = nil }
        if DateUtil.parseIso(doneAt) == nil { it.doneAt = nil }
        it.color = min(5, max(1, color ?? 1))
        return it
    }

    // MARK: Calcoli utili

    var dueDay: Date? { dueDate.flatMap(DateUtil.parseYmd) }

    var dueDateTime: Date? {
        guard let day = dueDay else { return nil }
        return DateUtil.at(day, time: dueTime ?? "23:59")
    }

    var isLate: Bool {
        guard kind == .todo, !done, let d = dueDateTime else { return false }
        return d < Date()
    }

    var doneDate: Date? { DateUtil.parseIso(doneAt) }
    var created: Date { DateUtil.parseIso(createdAt) ?? Date() }
    var updated: Date { DateUtil.parseIso(updatedAt) ?? Date() }

    /// Momento del promemoria in base alla scelta (stessa logica della web app)
    func computedRemindAt() -> String? {
        guard let r = remind, r != "none", r != "auto", let day = dueDay else { return nil }
        if r == "morning" { return DateUtil.iso(DateUtil.at(day, time: "09:00")) }
        guard let mins = Int(r) else { return nil }
        let base = DateUtil.at(day, time: dueTime ?? "09:00")
        return DateUtil.iso(base.addingTimeInterval(TimeInterval(-mins * 60)))
    }
}

// MARK: - Personalizzazione (nome dell'app e mascotte)

struct Custom: Codable, Equatable {
    var appName: String = "Mochi"
    var mascot: Mascot = .mochi

    enum CodingKeys: String, CodingKey { case appName = "nome_app", mascot = "mascotte" }

    init(appName: String = "Mochi", mascot: Mascot = .mochi) {
        self.appName = Custom.clean(appName)
        self.mascot = mascot
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        appName = Custom.clean((try? c.decodeIfPresent(String.self, forKey: .appName)) ?? nil)
        mascot = Mascot(rawValue: ((try? c.decodeIfPresent(String.self, forKey: .mascot)) ?? nil) ?? "") ?? .mochi
    }

    static func clean(_ s: String?) -> String {
        let t = (s ?? "").replacingOccurrences(of: "<", with: "").replacingOccurrences(of: ">", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? "Mochi" : String(t.prefix(24))
    }
}

// MARK: - Date

enum DateUtil {
    static let cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.locale = Locale(identifier: "it_IT")
        c.firstWeekday = 2
        return c
    }()

    private static let ymdF: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    private static let isoFrac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static let months = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
                         "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]
    static let weekdays = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"]

    static func ymd(_ d: Date) -> String { ymdF.string(from: d) }

    /// Accetta solo date che esistono davvero (niente 31 febbraio)
    static func parseYmd(_ s: String) -> Date? {
        guard s.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil,
              let d = ymdF.date(from: s), ymd(d) == s else { return nil }
        let y = cal.component(.year, from: d)
        return (2000...2100).contains(y) ? d : nil
    }

    static func iso(_ d: Date) -> String { isoFrac.string(from: d) }

    static func parseIso(_ s: String?) -> Date? {
        guard let s, !s.isEmpty else { return nil }
        if let d = isoFrac.date(from: s) ?? isoPlain.date(from: s) { return d }
        // Postgres può restituire microsecondi: li tolgo e riprovo
        let trimmed = s.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression)
        return isoPlain.date(from: trimmed)
    }

    /// Data solo se esiste davvero. Il mese può "sforare" (13 = gennaio dell'anno dopo)
    static func realDate(_ y: Int, _ m: Int, _ d: Int) -> Date? {
        var yy = y, mm = m
        while mm > 12 { mm -= 12; yy += 1 }
        while mm < 1 { mm += 12; yy -= 1 }
        var comp = DateComponents(); comp.year = yy; comp.month = mm; comp.day = d
        guard (2000...2100).contains(yy), let date = cal.date(from: comp) else { return nil }
        let c = cal.dateComponents([.month, .day], from: date)
        return (c.day == d && c.month == mm) ? date : nil
    }

    static func at(_ day: Date, time: String) -> Date {
        let p = time.split(separator: ":").compactMap { Int($0) }
        return cal.date(bySettingHour: p.first ?? 9, minute: p.count > 1 ? p[1] : 0, second: 0, of: day) ?? day
    }

    static func addDays(_ d: Date, _ n: Int) -> Date { cal.date(byAdding: .day, value: n, to: d) ?? d }
    static func today() -> String { ymd(Date()) }
    static func monthKey(_ d: Date) -> String { String(ymd(d).prefix(7)) }
    static func capitalized(_ s: String) -> String { s.prefix(1).uppercased() + s.dropFirst() }

    static func niceDate(_ s: String?) -> String {
        guard let s, let d = parseYmd(s) else { return "" }
        let t = cal.startOfDay(for: Date())
        let diff = cal.dateComponents([.day], from: t, to: d).day ?? 0
        switch diff {
        case 0: return "Oggi"
        case 1: return "Domani"
        case -1: return "Ieri"
        case 2...6: return capitalized(weekdays[cal.component(.weekday, from: d) - 1])
        default:
            let y = cal.component(.year, from: d) != cal.component(.year, from: t) ? " \(cal.component(.year, from: d))" : ""
            return "\(cal.component(.day, from: d)) \(months[cal.component(.month, from: d) - 1].prefix(3))\(y)"
        }
    }

    static func longDay(_ d: Date) -> String {
        "\(capitalized(weekdays[cal.component(.weekday, from: d) - 1])) \(cal.component(.day, from: d)) \(months[cal.component(.month, from: d) - 1])"
    }
}

extension Array where Element == Item {
    /// Ordina per data e ora (le voci senza data in fondo)
    func byDue() -> [Item] {
        sorted { ($0.dueDate ?? "9999", $0.dueTime ?? "99") < ($1.dueDate ?? "9999", $1.dueTime ?? "99") }
    }
}
