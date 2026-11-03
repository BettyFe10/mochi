import Foundation
import SwiftUI
import Supabase
import WidgetKit
#if os(iOS)
import UIKit
#endif

/// Configurazione letta da Info.plist (valori in Config/Secrets.xcconfig, mai nel repository)
enum AppConfig {
    private static func value(_ key: String) -> String {
        ((Bundle.main.object(forInfoDictionaryKey: key) as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }
    static var supabaseURL: URL? {
        let s = value("SupabaseURL")
        return s.hasPrefix("https://") ? URL(string: s) : nil
    }
    static var anonKey: String { value("SupabaseAnonKey") }
    static var webURL: URL? {
        let s = value("WebAppURL")
        return s.hasPrefix("https://") ? URL(string: s) : nil
    }
    static var privacyURL: URL? { webURL?.appendingPathComponent("privacy.html") }
    static var isOnline: Bool { supabaseURL != nil && !anonKey.isEmpty }
}

/// Modifica in attesa di essere inviata (quando si è offline)
struct OutboxOp: Codable {
    var kind: String          // "save" | "delete"
    var item: Item?
    var id: String?
}

@MainActor
final class Store: ObservableObject {
    enum Phase { case loading, login, ready }

    @Published var phase: Phase = .loading
    @Published var items: [Item] = []
    @Published var custom: Custom = SharedCache.loadCustom()
    @Published var userName: String = UserDefaults.standard.string(forKey: "mochi.nome") ?? ""
    @Published var email = ""
    @Published var synced = true
    @Published var cheerToken = 0
    @Published var toast: String?

    let client: SupabaseClient?
    var isOnline: Bool { client != nil }
    var mascot: Mascot { custom.mascot }

    init() {
        if AppConfig.isOnline, let url = AppConfig.supabaseURL {
            client = SupabaseClient(supabaseURL: url, supabaseKey: AppConfig.anonKey)
        } else {
            client = nil
        }
        items = SharedCache.loadItems()
    }

    // MARK: - Avvio e sincronizzazione

    func start() async {
        guard let client else {
            if userName.isEmpty { userName = "Federica" }
            phase = .ready
            await afterChange()
            return
        }
        let session = try? await client.auth.session
        if let session {
            apply(user: session.user)
            phase = .ready
            await refresh()
        } else {
            phase = .login
        }
    }

    /// Scarica le voci dal server (dopo aver inviato le modifiche fatte offline)
    func refresh() async {
        guard let client, phase == .ready else { return }
        await flushOutbox()
        do {
            let rows: [Item] = try await client.from("items").select().order("created_at").execute().value
            items = Array(rows.compactMap { $0.sanitized() }.prefix(5000))
            synced = true
        } catch {
            synced = false
        }
        let current = try? await client.auth.session
        if let current { apply(user: current.user) }
        await afterChange()
    }

    /// Dopo ogni modifica: cache per widget e offline, widget aggiornati, promemoria riprogrammati
    private func afterChange() async {
        SharedCache.saveItems(items)
        WidgetCenter.shared.reloadAllTimelines()
        await Reminders.reschedule(items, mascot: mascot)
    }

    func rescheduleReminders() async { await Reminders.reschedule(items, mascot: mascot) }

    // MARK: - Modifiche

    func save(_ input: Item, isNew: Bool) async {
        guard var it = input.sanitized() else { return }
        let previous = items.first { $0.id == it.id }
        if it.remind == "auto" { it.remind = "none" }
        it.remindAt = it.computedRemindAt()
        if it.remindAt != previous?.remindAt { it.reminded = false }
        it.updatedAt = DateUtil.iso(Date())
        if let i = items.firstIndex(where: { $0.id == it.id }) { items[i] = it } else { items.append(it) }
        if isNew { cheer() }
        await afterChange()
        await send(OutboxOp(kind: "save", item: it, id: nil))
    }

    func toggle(_ item: Item) async {
        guard let i = items.firstIndex(where: { $0.id == item.id }) else { return }
        items[i].done.toggle()
        items[i].doneAt = items[i].done ? DateUtil.iso(Date()) : nil
        items[i].updatedAt = DateUtil.iso(Date())
        if items[i].done { cheer() }
        let it = items[i]
        await afterChange()
        await send(OutboxOp(kind: "save", item: it, id: nil))
    }

    func delete(_ id: String) async {
        items.removeAll { $0.id == id }
        await afterChange()
        await send(OutboxOp(kind: "delete", item: nil, id: id))
        showToast("Eliminato")
    }

    // MARK: - Invio al server con coda offline

    private var outbox: [OutboxOp] {
        get { SharedCache.load([OutboxOp].self, "outbox.json") ?? [] }
        set { SharedCache.save(newValue, "outbox.json") }
    }

    private static func isNetwork(_ error: Error) -> Bool {
        if error is URLError { return true }
        let ns = error as NSError
        return ns.domain == NSURLErrorDomain || "\(error)".contains("NSURLErrorDomain")
    }

    private func perform(_ op: OutboxOp) async throws {
        guard let client else { return }
        if op.kind == "save", let it = op.item {
            try await client.from("items").upsert(it).execute()
        } else if op.kind == "delete", let id = op.id {
            try await client.from("items").delete().eq("id", value: id).execute()
        }
    }

    private func send(_ op: OutboxOp) async {
        guard isOnline else { return }
        do {
            try await perform(op)
            synced = true
        } catch {
            if Self.isNetwork(error) {
                var q = outbox; q.append(op); outbox = q
                synced = false
            } else {
                // Rifiutato dal server (limite raggiunto, dato non valido): non insistere
                showToast("\(error)".localizedCaseInsensitiveContains("limite") ? "Hai raggiunto il limite di voci 🍱" : "Non sono riuscita a salvare")
            }
        }
    }

    private func flushOutbox() async {
        let q = outbox
        guard !q.isEmpty else { return }
        var rest: [OutboxOp] = []
        for op in q {
            do { try await perform(op) } catch { if Self.isNetwork(error) { rest.append(op) } }
        }
        outbox = rest
    }

    // MARK: - Account

    private func text(_ v: AnyJSON?) -> String? {
        if case let .string(s)? = v { return s }
        return nil
    }

    private func apply(user: User) {
        email = user.email ?? ""
        let md = user.userMetadata
        userName = text(md["nome"]) ?? ""
        UserDefaults.standard.set(userName, forKey: "mochi.nome")
        if md["nome_app"] != nil || md["mascotte"] != nil {
            let c = Custom(appName: text(md["nome_app"]) ?? custom.appName,
                           mascot: Mascot(rawValue: text(md["mascotte"]) ?? "") ?? custom.mascot)
            if c != custom { setCustomLocally(c) }
        }
    }

    func login(email: String, password: String) async throws {
        guard let client else { return }
        let session = try await client.auth.signIn(email: email, password: password)
        apply(user: session.user)
        phase = .ready
        await refresh()
    }

    /// true = account creato ed entrata subito; false = deve confermare l'email
    func signup(name: String, email: String, password: String) async throws -> Bool {
        guard let client else { return false }
        let r = try await client.auth.signUp(email: email, password: password,
                                             data: ["nome": .string(name)], redirectTo: AppConfig.webURL)
        if let s = r.session {
            apply(user: s.user)
            phase = .ready
            await refresh()
            return true
        }
        return false
    }

    func forgot(email: String) async throws {
        try await client?.auth.resetPasswordForEmail(email, redirectTo: AppConfig.webURL)
    }

    func setName(_ name: String) async {
        let n = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(40))
        guard !n.isEmpty else { return }
        userName = n
        UserDefaults.standard.set(n, forKey: "mochi.nome")
        _ = try? await client?.auth.update(user: UserAttributes(data: ["nome": .string(n)]))
    }

    func logout() async {
        try? await client?.auth.signOut()
        clearLocal()
        phase = .login
    }

    func deleteAccount() async throws {
        guard let client else { return }
        try await client.rpc("elimina_il_mio_account").execute()
        try? await client.auth.signOut()
        clearLocal()
        phase = .login
    }

    private func clearLocal() {
        items = []
        email = ""
        userName = ""
        UserDefaults.standard.removeObject(forKey: "mochi.nome")
        UserDefaults.standard.removeObject(forKey: "mochi.recapSeen")
        SharedCache.remove("items.json")
        SharedCache.remove("outbox.json")
        Reminders.clearAll()
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: - Personalizzazione

    func saveCustom(_ c: Custom) async {
        setCustomLocally(c)
        cheer()
        showToast("Ciao! Ora sono \(c.mascot.name) 💗")
        await afterChange()
        _ = try? await client?.auth.update(user: UserAttributes(data: [
            "nome_app": .string(c.appName), "mascotte": .string(c.mascot.rawValue)
        ]))
    }

    private func setCustomLocally(_ c: Custom) {
        custom = c
        SharedCache.saveCustom(c)
        WidgetCenter.shared.reloadAllTimelines()
        #if os(iOS)
        if UIApplication.shared.supportsAlternateIcons, UIApplication.shared.alternateIconName != c.mascot.alternateIcon {
            UIApplication.shared.setAlternateIconName(c.mascot.alternateIcon) { _ in }
        }
        #endif
    }

    // MARK: - Varie

    func cheer() { cheerToken += 1 }

    func showToast(_ message: String) {
        toast = message
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_600_000_000)
            if self?.toast == message { self?.toast = nil }
        }
    }

    /// File JSON con tutte le voci, per il backup
    func exportFile() -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("mochi-backup-\(DateUtil.today()).json")
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        try? enc.encode(items).write(to: url)
        return url
    }

    var greeting: String {
        let h = DateUtil.cal.component(.hour, from: Date())
        let s = h < 6 ? "Buonanotte" : h < 13 ? "Buongiorno" : h < 18 ? "Buon pomeriggio" : "Buonasera"
        return userName.isEmpty ? "\(s)!" : "\(s), \(userName)!"
    }
}
