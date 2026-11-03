import SwiftUI

/// Entra / crea account / password dimenticata
struct LoginView: View {
    @EnvironmentObject var store: Store
    enum Mode { case login, signup, forgot }

    @State private var mode: Mode = .login
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var privacy = false
    @State private var message = ""
    @State private var messageOK = false
    @State private var busy = false

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                MascotView().frame(width: 150, height: 140).padding(.top, 40)
                Text(title).font(.rounded(30, .bold)).foregroundStyle(Palette.ink)
                Text(subtitle).font(.rounded(16, .regular)).foregroundStyle(Palette.ink2)
                    .multilineTextAlignment(.center).padding(.bottom, 8)

                if mode == .signup {
                    TextField("Come ti chiami?", text: $name).softField().fieldKind(.name)
                }
                TextField("Email", text: $email).softField().emailInput().fieldKind(.username)
                if mode != .forgot {
                    SecureField("Password (almeno 8 caratteri)", text: $password).softField()
                        .fieldKind(mode == .login ? .password : .newPassword)
                        .onSubmit { submit() }
                }
                if mode == .signup {
                    Toggle(isOn: $privacy) {
                        HStack(spacing: 4) {
                            Text("Ho letto l'").foregroundStyle(Palette.ink2)
                            if let url = AppConfig.privacyURL {
                                Link("informativa privacy", destination: url).fontWeight(.heavy)
                            } else {
                                Text("informativa privacy").fontWeight(.heavy).foregroundStyle(Palette.pinkDark)
                            }
                        }
                        .font(.rounded(13.5, .regular))
                    }
                    #if os(iOS)
                    .toggleStyle(.switch)
                    #else
                    .toggleStyle(.checkbox)
                    #endif
                }

                Text(message).font(.rounded(14, .bold))
                    .foregroundStyle(messageOK ? Palette.mint : Palette.late)
                    .frame(minHeight: 20).multilineTextAlignment(.center)

                PinkButton(title: busy ? "Un attimo..." : buttonTitle) { submit() }
                    .disabled(busy).opacity(busy ? 0.6 : 1)

                VStack(spacing: 10) {
                    Button(mode == .login ? "Non hai un account? Creane uno" : "Hai già un account? Entra") {
                        switchMode(mode == .login ? .signup : .login)
                    }
                    .foregroundStyle(Palette.pinkDark)
                    if mode == .login {
                        Button("Password dimenticata?") { switchMode(.forgot) }.foregroundStyle(Palette.ink2)
                    }
                }
                .font(.rounded(14.5, .heavy))
                .buttonStyle(.plain)
                .padding(.top, 8)
            }
            .frame(maxWidth: 380)
            .padding(.horizontal, 24)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var title: String {
        switch mode { case .login: return "Ciao!"; case .signup: return "Benvenuta!"; case .forgot: return "Niente panico" }
    }
    private var subtitle: String {
        switch mode {
        case .login: return "\(store.mascot.name) custodisce le tue cose.\nEntra per vederle."
        case .signup: return "Crea il tuo spazio personale.\nLe tue cose le vedi solo tu."
        case .forgot: return "Scrivi la tua email,\nti mando un link per una nuova password."
        }
    }
    private var buttonTitle: String {
        switch mode { case .login: return "Entra"; case .signup: return "Crea account"; case .forgot: return "Inviami il link" }
    }

    private static func validEmail(_ e: String) -> Bool {
        e.range(of: "^\\S+@\\S+\\.\\S+$", options: .regularExpression) != nil
    }

    private func switchMode(_ m: Mode) { mode = m; message = ""; messageOK = false }

    private func fail(_ s: String) { message = s; messageOK = false }

    @MainActor private func submit() {
        let e = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard Self.validEmail(e) else { return fail("Controlla l'email 🙈") }
        if mode != .forgot && password.count < 8 { return fail("La password deve avere almeno 8 caratteri") }
        if mode == .signup {
            if name.trimmingCharacters(in: .whitespaces).isEmpty { return fail("Dimmi come ti chiami 🌸") }
            if !privacy { return fail("Conferma di aver letto l'informativa privacy") }
        }
        busy = true
        Task { @MainActor in
            defer { busy = false }
            do {
                switch mode {
                case .login:
                    try await store.login(email: e, password: password)
                case .signup:
                    let entered = try await store.signup(name: name.trimmingCharacters(in: .whitespaces), email: e, password: password)
                    if !entered {
                        switchMode(.login)
                        message = "Ti ho mandato un'email: apri il link e poi entra 📬"; messageOK = true
                    }
                case .forgot:
                    try await store.forgot(email: e)
                    switchMode(.login)
                    message = "Fatto! Apri il link nella mail per scegliere la nuova password 📬"; messageOK = true
                }
            } catch {
                let s = "\(error)".lowercased()
                if s.contains("confirm") { fail("Prima conferma l'email: ti ho mandato un link 📬") }
                else if s.contains("already") || s.contains("registered") { fail("Questa email ha già un account") }
                else if s.contains("disabled") || s.contains("not allowed") { fail("Le registrazioni sono chiuse") }
                else if s.contains("invalid") || s.contains("credentials") { fail("Email o password non corrette 🙈") }
                else if s.contains("nsurlerrordomain") || s.contains("offline") { fail("Sembra che manchi la connessione") }
                else { fail("Qualcosa è andato storto, riprova") }
            }
        }
    }
}
