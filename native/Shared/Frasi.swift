import Foundation

/// Frasi motivazionali di Mochi (stesso elenco della web app, file frasi.js).
/// Una al giorno sotto il saluto; toccandola ne esce un'altra.
enum Frasi {
    static let tutte: [String] = [
        "Una cosa alla volta è comunque un passo avanti.",
        "Non devi fare tutto oggi. Solo la prossima cosa.",
        "Anche le giornate piccole contano.",
        "Hai già superato giorni più difficili di questo.",
        "Spuntare una cosa dalla lista è un piccolo superpotere.",
        "Respira. Il resto si mette in fila da solo.",
        "Fatto è meglio di perfetto.",
        "Il tuo ritmo va benissimo così.",
        "Oggi vale anche solo provarci.",
        "Le cose grandi sono fatte di cose piccole messe in fila.",
        "Una pausa non è tempo perso: è benzina.",
        "Sii gentile con te come lo saresti con un'amica.",
        "Quello che ieri sembrava enorme oggi è nella lista.",
        "Ricordare le cose ora è compito mio. Tu pensa a vivere.",
        "Un passo storto resta comunque un passo.",
        "Il momento migliore per iniziare è adesso, con calma.",
        "Hai il diritto di fare le cose a modo tuo.",
        "Oggi scegli una cosa importante e falla con amore.",
        "Non serve correre per arrivare.",
        "Ogni spunta è un piccolo applauso.",
        "Anche Mochi a volte è un po' molle. Va bene così.",
        "Un buon caffè, un respiro e via.",
        "La lista è lunga, ma tu sei più tosta.",
        "Le cose fatte con il sorriso pesano la metà.",
        "Domani ringrazierai la te di oggi.",
        "Prima le cose importanti, poi quelle urgenti di qualcun altro.",
        "Concediti di fare una cosa sola, bene.",
        "Non sei in ritardo: sei in viaggio.",
        "Il disordine di oggi è il progetto di domani.",
        "Piccoli passi, grandi giornate.",
        "Brilla anche se nessuno guarda.",
        "Oggi è un buon giorno per essere orgogliosa di te.",
        "Hai già fatto più di quanto pensi.",
        "Se ti senti stanca, riposa. Non mollare.",
        "Le idee migliori arrivano quando le scrivi.",
        "Una cosa fatta libera spazio per una cosa bella.",
        "Il coraggio a volte è solo cominciare.",
        "Ogni giorno è una pagina nuova, anche se di mercoledì.",
        "Sushi, sorrisi e cose spuntate: la giornata perfetta.",
        "Credi nei tuoi piccoli progressi.",
        "Anche le nuvole passano, una alla volta.",
        "Fai spazio a quello che ti fa stare bene."
    ]

    /// Frase del giorno, spostata di "shift" posizioni quando la tocchi
    static func delGiorno(shift: Int = 0, date: Date = Date()) -> String {
        let cal = Calendar(identifier: .gregorian)
        let day = cal.ordinality(of: .day, in: .year, for: date) ?? 1
        let year = cal.component(.year, from: date)
        let i = ((day + year * 7 + shift) % tutte.count + tutte.count) % tutte.count
        return tutte[i]
    }
}
