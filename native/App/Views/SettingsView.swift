import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    var onRecap: () -> Void

    @State private var appName = ""
    @State private var mascot: Mascot = .mochi
    @State private var name = ""
    @State private var notificationsOn = false
    @State private var backupURL: URL?
    @State private var confirmLogout = false
    @State private var askDelete = false
    @State private var deleteText = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 8) {
                    MascotView().frame(width: 40, height: 38)
                    Text("Impostazioni").font(.rounded(20, .bold)).foregroundStyle(Palette.ink)
                    Spacer()
                    Button("Chiudi") { dismiss() }.font(.rounded(15, .heavy)).foregroundStyle(Palette.pinkDark).buttonStyle(.plain)
                }
                .padding(.top, 18)

                // Nome dell'app e mascotte
                group("Nome e mascotte") {
                    TextField("Nome dell'app", text: $appName).softField()
                        .onChange(of: appName) { _, v in if v.count > 24 { appName = String(v.prefix(24)) } }
                    HStack(spacing: 10) {
                        ForEach(Mascot.allCases) { m in
                            Button { withAnimation(.spring(response: 0.3)) { mascot = m } } label: {
                                VStack(spacing: 6) {
                                    MascotView(mascot: m, forceHappy: mascot == m, tappable: false).frame(width: 74, height: 68)
                                    Text(m.name).font(.rounded(16, .bold)).foregroundStyle(Palette.ink)
                                    Text(m.descr).font(.rounded(11, .regular)).foregroundStyle(Palette.ink2)
                                        .multilineTextAlignment(.center).lineLimit(3).fixedSize(horizontal: false, vertical: true)
                                }
                                .padding(.vertical, 12).padding(.horizontal, 6)
                                .frame(maxWidth: .infinity)
                                .background(mascot == m ? Palette.pinkLight : Palette.bg, in: RoundedRectangle(cornerRadius: 20))
                                .overlay(RoundedRectangle(cornerRadius: 20).stroke(mascot == m ? Palette.pink : Palette.line, lineWidth: 3))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    #if os(iOS)
                    Text("Sull'iPhone cambia anche l'icona dell'app. Il nome sotto l'icona resta quello di installazione.")
                        .font(.rounded(12.5, .regular)).foregroundStyle(Palette.ink2)
                    #endif
                    PinkButton(title: "Salva") {
                        Task { @MainActor in await store.saveCustom(Custom(appName: appName, mascot: mascot)) }
                    }
                    .disabled(Custom(appName: appName, mascot: mascot) == store.custom)
                    .opacity(Custom(appName: appName, mascot: mascot) == store.custom ? 0.5 : 1)
                }

                if store.isOnline {
                    group("Il tuo nome") {
                        HStack {
                            TextField("Come ti chiami?", text: $name).softField()
                            FilterChip(label: "Salva", on: true) {
                                Task { @MainActor in await store.setName(name); store.showToast("Piacere, \(store.userName)! 🍣") }
                            }
                        }
                        Text(store.email).font(.rounded(12.5, .regular)).foregroundStyle(Palette.ink2)
                    }
                }

                group("Promemoria") {
                    row(notificationsOn ? "Attivi su questo dispositivo ✅" : "Ricevi una notifica all'orario giusto") {
                        if !notificationsOn {
                            FilterChip(label: "Attiva", on: true) {
                                Task { @MainActor in
                                    notificationsOn = await Reminders.requestPermission()
                                    await store.rescheduleReminders()
                                    if !notificationsOn { store.showToast("Puoi attivarle dalle Impostazioni del sistema") }
                                }
                            }
                        }
                    }
                }

                group("Altro") {
                    row("Recap del mese") { FilterChip(label: "Apri", on: false, action: onRecap) }
                    row("Backup di tutte le tue cose") {
                        if let backupURL { ShareLink(item: backupURL) { Text("Scarica").font(.rounded(14, .bold)) } }
                    }
                    if let url = AppConfig.privacyURL {
                        row("Informativa privacy") { Link("Leggi", destination: url).font(.rounded(14, .bold)) }
                    }
                }

                if store.isOnline {
                    group("Account") {
                        row("Esci da questo dispositivo") { FilterChip(label: "Esci", on: false) { confirmLogout = true } }
                        row("Elimina account e dati per sempre") {
                            Button("Elimina") { deleteText = ""; askDelete = true }
                                .font(.rounded(14, .bold)).foregroundStyle(Palette.late).buttonStyle(.plain)
                        }
                    }
                } else {
                    Text("Modalità prova: i dati restano solo su questo dispositivo. Inserisci le chiavi Supabase per account e sincronizzazione.")
                        .font(.rounded(13, .regular)).foregroundStyle(Palette.ink2)
                }
            }
            .padding(.horizontal, 18).padding(.bottom, 30)
        }
        .background(Palette.card)
        .presentationCornerRadius(28)
        .macSheetSize(480, 700)
        .task {
            appName = store.custom.appName
            mascot = store.custom.mascot
            name = store.userName
            notificationsOn = await Reminders.isAuthorized()
            backupURL = store.exportFile()
        }
        // Il backup contiene tutte le tue cose: non lasciarlo nei file temporanei
        .onDisappear { if let backupURL { try? FileManager.default.removeItem(at: backupURL) } }
        .confirmationDialog("Vuoi uscire da questo dispositivo?", isPresented: $confirmLogout, titleVisibility: .visible) {
            Button("Esci", role: .destructive) { dismiss(); Task { @MainActor in await store.logout() } }
        }
        .alert("Eliminare l'account?", isPresented: $askDelete) {
            TextField("Scrivi ELIMINA", text: $deleteText)
            Button("Annulla", role: .cancel) {}
            Button("Elimina per sempre", role: .destructive) {
                guard deleteText == "ELIMINA" else { store.showToast("Eliminazione annullata"); return }
                dismiss()
                Task { @MainActor in
                    do { try await store.deleteAccount(); store.showToast("Account eliminato. Ciao da \(store.mascot.name) 🍣") }
                    catch { store.showToast("Non sono riuscita a eliminarlo, riprova") }
                }
            }
        } message: {
            Text("Verranno cancellati per sempre il tuo account e tutte le tue cose. Prima scarica un backup se ti serve.")
        }
    }

    private func group<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.rounded(12.5, .heavy)).foregroundStyle(Palette.ink2).textCase(.uppercase)
            content()
        }
        .padding(14)
        .background(Palette.bg, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func row<Trailing: View>(_ text: String, @ViewBuilder _ trailing: () -> Trailing) -> some View {
        HStack {
            Text(text).font(.rounded(15, .bold)).foregroundStyle(Palette.ink)
            Spacer()
            trailing()
        }
    }
}
