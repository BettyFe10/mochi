import Foundation

/// File condivisi tra app e widget tramite App Group.
/// Contengono solo la copia locale delle voci dell'utente collegato su questo dispositivo.
enum SharedCache {
    /// Identificativo dell'App Group, letto da Info.plist (impostato in project.yml)
    static var groupID: String {
        (Bundle.main.object(forInfoDictionaryKey: "MochiAppGroup") as? String) ?? "group.it.bettyfe.mochi"
    }

    static var folder: URL {
        if let u = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupID) { return u }
        // Ripiego (es. App Group non ancora configurato): cartella privata dell'app
        let u = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Mochi")
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }

    private static func url(_ name: String) -> URL { folder.appendingPathComponent(name) }

    static func load<T: Decodable>(_ type: T.Type, _ name: String) -> T? {
        guard let data = try? Data(contentsOf: url(name)) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    static func save<T: Encodable>(_ value: T, _ name: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        try? data.write(to: url(name), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func remove(_ name: String) { try? FileManager.default.removeItem(at: url(name)) }

    // Comodità
    static func loadItems() -> [Item] { (load([Item].self, "items.json") ?? []).compactMap { $0.sanitized() } }
    static func saveItems(_ items: [Item]) { save(Array(items.prefix(5000)), "items.json") }
    static func loadCustom() -> Custom { load(Custom.self, "custom.json") ?? Custom() }
    static func saveCustom(_ c: Custom) { save(c, "custom.json") }
}
