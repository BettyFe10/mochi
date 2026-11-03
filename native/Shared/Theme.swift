import SwiftUI

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: opacity)
    }
}

/// Palette rosa pastello, la stessa della web app
enum Palette {
    static let bg = Color(hex: 0xFFF5F8)
    static let bg2 = Color(hex: 0xFFE9F0)
    static let card = Color.white
    static let ink = Color(hex: 0x4A2F3A)
    static let ink2 = Color(hex: 0x8A6A77)
    static let line = Color(hex: 0xF6DBE5)
    static let pink = Color(hex: 0xFF8FB1)
    static let pinkDark = Color(hex: 0xE85D8A)
    static let pinkLight = Color(hex: 0xFFE1EB)
    static let salmonLight = Color(hex: 0xFFE8DE)
    static let lav = Color(hex: 0xE5DCFF)
    static let lavDark = Color(hex: 0x7A62C9)
    static let mint = Color(hex: 0x3F8F6A)
    static let late = Color(hex: 0xC0394E)
    static let lateBg = Color(hex: 0xFFD9D9)
    static let noteColors: [Color] = [0xFFF1C2, 0xFFD9E5, 0xD8F1E4, 0xE5DCFF, 0xFFE2D3].map { Color(hex: $0) }

    static func area(_ a: Area) -> Color { a == .lavoro ? lavDark : pink }
    static func areaLight(_ a: Area) -> Color { a == .lavoro ? lav : pinkLight }
    static func note(_ c: Int?) -> Color { noteColors[min(4, max(0, (c ?? 1) - 1))] }

    static let button = LinearGradient(colors: [pink, pinkDark], startPoint: .topLeading, endPoint: .bottomTrailing)
}

extension Font {
    static func rounded(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }
}

/// Scheda bianca con ombra rosa, usata ovunque
struct CardStyle: ViewModifier {
    var padding: CGFloat = 14
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(Palette.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .shadow(color: Palette.pinkDark.opacity(0.12), radius: 10, y: 4)
    }
}

extension View {
    func card(padding: CGFloat = 14) -> some View { modifier(CardStyle(padding: padding)) }
}

/// Mascotte disponibili. Le immagini sono negli asset (normale, felice, occhi chiusi)
enum Mascot: String, CaseIterable, Codable, Identifiable {
    case mochi, nigi, bolla
    var id: String { rawValue }

    var name: String {
        switch self {
        case .nigi: return "Nigi"
        case .mochi: return "Mochi"
        case .bolla: return "Bolla"
        }
    }

    var descr: String {
        switch self {
        case .nigi: return "Un nigiri al salmone con un fiore di ciliegio"
        case .mochi: return "Un dolcetto di riso alla fragola, morbido morbido"
        case .bolla: return "Una creaturina tascabile che vive nelle bolle di sapone"
        }
    }

    /// Nome dell'icona alternativa su iPhone (nil = icona principale)
    var alternateIcon: String? {
        switch self {
        case .mochi: return nil
        case .nigi: return "AppIcon-Nigi"
        case .bolla: return "AppIcon-Bolla"
        }
    }

    var gradient: [Color] {
        switch self {
        case .nigi: return [Color(hex: 0xFFD6E4), Color(hex: 0xFFB3CC)]
        case .mochi: return [Color(hex: 0xFFE1EA), Color(hex: 0xFFC7D6)]
        case .bolla: return [Color(hex: 0xE9E1FF), Color(hex: 0xCFC0FF)]
        }
    }

    enum Mood: String { case normal, happy, blink }
    func image(_ mood: Mood) -> String { "\(rawValue)_\(mood.rawValue)" }
}
