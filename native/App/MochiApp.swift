import SwiftUI

@main
struct MochiApp: App {
    @StateObject private var store = Store()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .preferredColorScheme(.light)
                .tint(Palette.pinkDark)
                .task { await store.start() }
                .onChange(of: scenePhase) { _, phase in
                    // Tornando in primo piano (es. dopo ore) riallinea i dati con gli altri dispositivi
                    if phase == .active { Task { await store.refresh() } }
                }
                #if os(macOS)
                .frame(minWidth: 420, minHeight: 640)
                #endif
        }
        #if os(macOS)
        .defaultSize(width: 520, height: 860)
        .windowResizability(.contentMinSize)
        #endif
    }
}

struct RootView: View {
    @EnvironmentObject var store: Store

    var body: some View {
        ZStack(alignment: .bottom) {
            Palette.bg.ignoresSafeArea()
            switch store.phase {
            case .loading:
                VStack(spacing: 16) {
                    MascotView(tappable: false).frame(width: 140, height: 130)
                    Text(Frasi.delGiorno()).font(.rounded(16, .bold)).italic()
                        .foregroundStyle(Palette.pinkDark).multilineTextAlignment(.center).padding(.horizontal, 32)
                    ProgressView().tint(Palette.pinkDark)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .login:
                LoginView()
            case .ready:
                MainView()
                    // Mentre l'app è aperta controlla le novità dagli altri dispositivi ogni minuto
                    .task {
                        while !Task.isCancelled {
                            try? await Task.sleep(nanoseconds: 60_000_000_000)
                            await store.refresh()
                        }
                    }
            }
            if let t = store.toast {
                ToastView(text: t).padding(.bottom, 100).zIndex(10)
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: store.toast)
        .animation(.easeInOut, value: store.phase)
    }
}
