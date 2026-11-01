/**
 * Beslissingshulp: alle regels op één plek.
 *
 * Groen = zelf beslissen, oranje = zelf oplossen en vastleggen in de Hub,
 * rood = naar Jarno. Tekst tussen [[...]] is een voorstel dat Jarno nog
 * bevestigt; het team ziet die tekst als gewone regel, de eigenaar ziet hem
 * gemarkeerd in het beheerscherm. Regels aanpassen = dit bestand aanpassen.
 */

export type Niveau = "g" | "o" | "r";
export type Rol = "cc" | "vg" | "bi";

export type Keuzehulp = {
  vraag: string;
  opties: { antwoord: string; uitkomst?: { niveau: Niveau; tekst: string }; vervolg?: Keuzehulp }[];
};

export type Situatie = {
  id: string;
  titel: string;
  categorie: string;
  niveau: Niveau;
  eigenaar: Rol;
  voorbereiding?: Rol;
  waarom: string;
  situatie: string;
  stappen: string[];
  naarJarno: string;
  magZelf: string[];
  vastleggen: string;
  afgerond: string;
  klantbericht: string | null;
  zoekwoorden: string;
  keuzehulp?: Keuzehulp;
  nood?: boolean;
};

export type BeslisData = {
  reactietermijn: string;
  categorieen: { id: string; naam: string; icoon: string }[];
  escalatieVelden: { id: string; vraag: string; placeholder: string }[];
  situaties: Situatie[];
  grenzen: { onderwerp: string; zelf: string; jarno: string }[];
  bevoegdheden: { rol: Rol; zelf: string[]; niet: string[] }[];
  top: Record<Rol, string[]>;
  openPunten: string[];
};

export const ROLLEN: Record<Rol, { naam: string; uitleg: string; doet: string[]; nietZelf: string[] }> = {
  cc: {
    naam: "Content Creative",
    uitleg: "Eigenaar van de klant en de hele contentflow. Lost alles op wat niet bij Jarno ligt.",
    doet: ["Scripts: extra, eruit, wijzigen", "Planning, deadlines en opnames", "Feedback, revisies en editors", "Vragen over status en resultaten"],
    nietZelf: ["Korting of iets gratis", "Contract wijzigen of beëindigen", "Kosten boven €250"],
  },
  vg: {
    naam: "Videograaf",
    uitleg: "Eigenaar van de opnamedag. Beslist op locatie hoe het wel kan.",
    doet: ["Aanpak en volgorde op locatie", "Scripts ter plekke aanpassen", "Tot 1 uur uitlopen", "Opname stoppen als het onveilig is"],
    nietZelf: ["Extra draaidagen toezeggen", "Afspraken over kosten of uitloop"],
  },
  bi: {
    naam: "Jarno",
    uitleg: "Beslist alleen over geld, contracten en grote risico's. Niet over het dagelijkse werk.",
    doet: ["Stoppen, verlengen of contract wijzigen", "Korting, compensatie of iets gratis", "Facturen betwisten en betaalafspraken", "Kosten boven €250, juridisch en datalek"],
    nietZelf: ["Scripts en feedback", "Planning en opnames", "Editors en revisies"],
  },
};

export const BESLIS: BeslisData = {
  "reactietermijn": "[[1 werkdag]]",
  "categorieen": [
    {
      "id": "script",
      "naam": "Scripts en voorbereiding",
      "icoon": "doc"
    },
    {
      "id": "editing",
      "naam": "Editing en feedback",
      "icoon": "cut"
    },
    {
      "id": "opname",
      "naam": "Opnamedagen en afzeggingen",
      "icoon": "cam"
    },
    {
      "id": "deadline",
      "naam": "Deadlines en leveringen",
      "icoon": "clock"
    },
    {
      "id": "aantal",
      "naam": "Extra en minder video's",
      "icoon": "list"
    },
    {
      "id": "klacht",
      "naam": "Klachten en ontevreden klanten",
      "icoon": "alert"
    },
    {
      "id": "social",
      "naam": "Social media en resultaten",
      "icoon": "chart"
    },
    {
      "id": "factuur",
      "naam": "Facturatie en betalingen",
      "icoon": "file"
    },
    {
      "id": "contract",
      "naam": "Contracten en samenwerkingen",
      "icoon": "key"
    },
    {
      "id": "ziekte",
      "naam": "Ziekte en afwezigheid",
      "icoon": "user"
    },
    {
      "id": "team",
      "naam": "Intern en team",
      "icoon": "users"
    },
    {
      "id": "techniek",
      "naam": "Techniek en portaal",
      "icoon": "tool"
    }
  ],
  "escalatieVelden": [
    {
      "id": "klant",
      "vraag": "Welke klant betreft het?",
      "placeholder": "Klantnaam en contactpersoon"
    },
    {
      "id": "wat",
      "vraag": "Wat is er precies gebeurd?",
      "placeholder": "Feiten, data, wat de klant letterlijk vraagt"
    },
    {
      "id": "acties",
      "vraag": "Welke acties zijn al ondernomen?",
      "placeholder": "Wat heb je zelf al gedaan of gevraagd"
    },
    {
      "id": "opties",
      "vraag": "Welke oplossingen zijn mogelijk?",
      "placeholder": "Minimaal twee opties, met gevolgen"
    },
    {
      "id": "advies",
      "vraag": "Wat is jouw advies?",
      "placeholder": "Welke optie kies jij en waarom"
    },
    {
      "id": "besluit",
      "vraag": "Welke beslissing is van Jarno nodig?",
      "placeholder": "Eén concrete vraag: akkoord op ..."
    }
  ],
  "situaties": [
    {
      "id": "extra-script",
      "titel": "Klant wil een extra script",
      "categorie": "script",
      "niveau": "g",
      "eigenaar": "cc",
      "waarom": "Scripts schrijven binnen het pakket is jouw werk. Alleen een extra video is een nieuwe afspraak.",
      "situatie": "De klant wil een script erbij, bijvoorbeeld een nieuw idee of een reserve voor de opnamedag.",
      "stappen": [
        "Check hoeveel video's in het pakket zitten en hoeveel scripts er al zijn.",
        "Past het binnen het aantal? Schrijf het script en zet het ter goedkeuring.",
        "Komt het er bovenop? Bied aan om een ander script te vervangen.",
        "Leg in de Hub vast welk script erbij komt of vervalt."
      ],
      "naarJarno": "De klant wil er echt een video bij, bovenop het pakket.",
      "magZelf": [
        "Scripts toevoegen binnen het aantal video's van het pakket.",
        "[[Eén reservescript per opnamedag]] schrijven."
      ],
      "vastleggen": "Nieuw script en welk script eventueel vervalt.",
      "afgerond": "Het script is goedgekeurd en staat in de planning.",
      "klantbericht": "Hoi [naam], leuk idee, dank je! Ik schrijf het script uit en stuur het je uiterlijk [dag] ter goedkeuring. Dan wisselen we het om met [onderwerp], zodat we binnen je pakket blijven. Laat maar weten of dat goed is.",
      "zoekwoorden": "extra script, script erbij, nog een script, nieuw script, script toevoegen, reserve script, idee erbij",
      "keuzehulp": {
        "vraag": "Past het extra script binnen het aantal video's van het pakket?",
        "opties": [
          {
            "antwoord": "Ja, of het vervangt een ander script",
            "uitkomst": {
              "niveau": "g",
              "tekst": "Schrijf het script, zet het ter goedkeuring en werk de planning bij."
            }
          },
          {
            "antwoord": "Nee, het wordt een extra video",
            "uitkomst": {
              "niveau": "o",
              "tekst": "Bied het aan als extra video tegen [[de vaste prijs]]. Wil de klant het gratis of structureel meer? Dan naar Jarno."
            }
          }
        ]
      }
    },
    {
      "id": "script-eruit",
      "titel": "Klant wil een script of video eruit",
      "categorie": "script",
      "niveau": "g",
      "eigenaar": "cc",
      "waarom": "Scripts en video's omwisselen binnen het pakket is jouw keuze. Minder afnemen raakt het contract.",
      "situatie": "De klant wil een script of video niet meer laten maken.",
      "stappen": [
        "Haal het script uit de planning.",
        "Bied direct een vervangend onderwerp aan.",
        "Schrijf het nieuwe script en zet het ter goedkeuring.",
        "Informeer de videograaf als de opnamedag al gepland is."
      ],
      "naarJarno": "De klant wil er niets voor in de plaats en dus minder video's afnemen.",
      "magZelf": [
        "Scripts en video's schrappen en vervangen binnen het pakket."
      ],
      "vastleggen": "Welk script vervalt en wat ervoor in de plaats komt.",
      "afgerond": "Het afgesproken aantal goedgekeurde scripts staat weer klaar.",
      "klantbericht": "Hoi [naam], helemaal goed, dank voor het laten weten. Ik haal [onderwerp] eruit en stel er [nieuw onderwerp] voor in de plaats. Het script stuur ik je uiterlijk [dag]. Heb je zelf een voorkeur voor een onderwerp? Dan hoor ik het graag.",
      "zoekwoorden": "script eruit, script schrappen, script verwijderen, video eruit, video schrappen, niet opnemen, vervangen, omwisselen, andere video",
      "keuzehulp": {
        "vraag": "Wil de klant er iets anders voor in de plaats?",
        "opties": [
          {
            "antwoord": "Ja, of het maakt niet uit",
            "uitkomst": {
              "niveau": "g",
              "tekst": "Schrap het script, kies een vervanger en informeer de videograaf."
            }
          },
          {
            "antwoord": "Nee, hij wil minder video's",
            "uitkomst": {
              "niveau": "r",
              "tekst": "Minder video's afnemen wijzigt de afspraak. Stuur de klant het wachtbericht en leg het voor met jouw advies."
            }
          }
        ]
      }
    },
    {
      "id": "script-lastminute",
      "titel": "Klant wil last minute een script wijzigen",
      "categorie": "script",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Je lost het zelf op, maar je checkt eerst of de opname het aankan.",
      "situatie": "Vlak voor of op de opnamedag wil de klant een script aanpassen.",
      "stappen": [
        "Vraag wat er precies moet veranderen.",
        "Kleine wijziging: pas het script aan en stuur het direct naar de videograaf.",
        "Grote wijziging: check eerst met de videograaf of het haalbaar is.",
        "Niet haalbaar? Neem het oude script op of schuif het nieuwe door naar de volgende opname.",
        "Leg de afspraak vast in de Hub."
      ],
      "naarJarno": "De wijziging vraagt extra opnametijd of een extra draaidag met kosten.",
      "magZelf": [
        "Scripts aanpassen tot de opname begint.",
        "Een script doorschuiven naar de volgende opnamedag."
      ],
      "vastleggen": "Nieuwe versie van het script en wat er met de opname gebeurt.",
      "afgerond": "Het script is opgenomen of staat bij de volgende opname.",
      "klantbericht": "Hoi [naam], dank voor je aanpassing. Ik verwerk het in het script en stem het af met onze videograaf. Je hoort vandaag nog van me of we het op [datum] zo kunnen opnemen.",
      "zoekwoorden": "last minute, script wijzigen, op het laatste moment, vlak voor opname, script aanpassen, wijziging opnamedag, morgen opname, toch anders",
      "keuzehulp": {
        "vraag": "Wanneer is de opname?",
        "opties": [
          {
            "antwoord": "Over meer dan [[48 uur]]",
            "uitkomst": {
              "niveau": "g",
              "tekst": "Pas het script aan, laat de klant akkoord geven en stuur de nieuwe versie naar de videograaf."
            }
          },
          {
            "antwoord": "Binnen [[48 uur]]",
            "vervolg": {
              "vraag": "Is het een kleine wijziging (tekst, hook, volgorde)?",
              "opties": [
                {
                  "antwoord": "Ja",
                  "uitkomst": {
                    "niveau": "g",
                    "tekst": "Pas het direct aan en stuur het meteen naar de videograaf."
                  }
                },
                {
                  "antwoord": "Nee, ander onderwerp of andere locatie",
                  "uitkomst": {
                    "niveau": "o",
                    "tekst": "Bel de videograaf. Haalbaar? Doorvoeren. Niet haalbaar? Neem het oude script op of schuif het nieuwe door naar de volgende opname."
                  }
                }
              ]
            }
          },
          {
            "antwoord": "Op de opnamedag zelf",
            "uitkomst": {
              "niveau": "o",
              "tekst": "Kleine aanpassingen doet de videograaf ter plekke. Grote wijzigingen gaan naar de volgende opnamedag."
            }
          }
        ]
      }
    },
    {
      "id": "script-feedback",
      "titel": "Klant wil een script aanpassen of vindt het niet goed",
      "categorie": "script",
      "niveau": "g",
      "eigenaar": "cc",
      "waarom": "Feedback op scripts hoort bij het vak.",
      "situatie": "De klant heeft feedback op een of meer scripts, of wil een andere toon of insteek.",
      "stappen": [
        "Vraag concreet wat er niet goed is of anders moet.",
        "Herschrijf het binnen [[2 werkdagen]] of kies een ander onderwerp.",
        "Zet het opnieuw ter goedkeuring."
      ],
      "naarJarno": "Niet nodig. Wil de klant een totaal andere aanpak? Zie 'Klant wil alle scripts anders'.",
      "magZelf": [
        "Scripts herschrijven of vervangen.",
        "Toon, hook en call to action aanpassen."
      ],
      "vastleggen": "Nieuwe versie van het script.",
      "afgerond": "Het script is goedgekeurd.",
      "klantbericht": "Hoi [naam], dank voor je feedback, daar kan ik goed mee verder. Ik pas het script aan en stuur je de nieuwe versie uiterlijk [dag].",
      "zoekwoorden": "script niet leuk, script niet goed, feedback script, script aanpassen, andere toon, commercieel, insteek, hook, herschrijven"
    },
    {
      "id": "alle-scripts-anders",
      "titel": "Klant wil alle scripts anders",
      "categorie": "script",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Je lost het zelf op, maar het raakt de planning en mogelijk de strategie.",
      "situatie": "De klant wil de hele set scripts of de richting veranderen.",
      "stappen": [
        "Plan een kort gesprek: wat wil hij anders en waarom?",
        "Leg de nieuwe richting vast.",
        "Herschrijf de scripts en verschuif de opname als dat nodig is.",
        "Informeer de videograaf over de nieuwe planning."
      ],
      "naarJarno": "De nieuwe richting past niet meer in het pakket of vraagt een andere dienst.",
      "magZelf": [
        "Richting bijsturen en scripts herschrijven.",
        "De opname verschuiven."
      ],
      "vastleggen": "Nieuwe richting en planning.",
      "afgerond": "Alle scripts zijn goedgekeurd volgens de nieuwe richting.",
      "klantbericht": "Hoi [naam], dank dat je dit aangeeft. Zullen we even 15 minuten bellen, zodat ik precies weet welke kant je op wilt? Dan pas ik daarna alle scripts in één keer aan. Schikt [dag/tijd] je?",
      "zoekwoorden": "alle scripts, alles anders, andere richting, scripts opnieuw, strategie anders"
    },
    {
      "id": "scripts-geen-reactie",
      "titel": "Klant reageert niet op scripts",
      "categorie": "script",
      "niveau": "g",
      "eigenaar": "cc",
      "waarom": "Herinneren en de planning laten schuiven kun je zelf. Pas bij lang stil of open facturen is er risico.",
      "situatie": "De klant keurt de scripts niet goed en reageert niet.",
      "stappen": [
        "Stuur een herinnering via het vaste kanaal.",
        "Geen reactie na [[2 werkdagen]]: bel.",
        "Nog steeds niets? Mail dat de planning schuift en noem een nieuwe datum.",
        "Zet de klant op oranje in de Hub."
      ],
      "naarJarno": "Geen reactie na [[10 werkdagen]], of er staat ook een factuur open.",
      "magZelf": [
        "Herinneren, bellen en de planning verschuiven."
      ],
      "vastleggen": "Herinneringen en nieuwe planning.",
      "afgerond": "De scripts zijn goedgekeurd.",
      "klantbericht": "Hoi [naam], ik wilde even checken of je de scripts al hebt kunnen bekijken. Als ik je akkoord uiterlijk [dag] heb, houden we de opname op [datum] aan. Laat gerust weten als je vragen hebt!",
      "zoekwoorden": "geen reactie, reageert niet, scripts niet goedgekeurd, wacht op klant, stil, hoor niks, antwoordt niet",
      "keuzehulp": {
        "vraag": "Hoe lang wacht je al op een reactie?",
        "opties": [
          {
            "antwoord": "Korter dan [[2 werkdagen]]",
            "uitkomst": {
              "niveau": "g",
              "tekst": "Stuur één vriendelijke herinnering en wacht af. Geen verdere actie nodig."
            }
          },
          {
            "antwoord": "Tussen [[2 en 10 werkdagen]]",
            "uitkomst": {
              "niveau": "o",
              "tekst": "Bel de klant, laat de planning schuiven en zet de klant op oranje. Dit valt binnen jouw bevoegdheid."
            }
          },
          {
            "antwoord": "Langer dan [[10 werkdagen]]",
            "vervolg": {
              "vraag": "Staat er een factuur open of zijn er signalen dat de klant wil stoppen?",
              "opties": [
                {
                  "antwoord": "Ja",
                  "uitkomst": {
                    "niveau": "r",
                    "tekst": "Risico op beëindiging of betalingsprobleem. Vul het escalatieformat in met jouw voorstel."
                  }
                },
                {
                  "antwoord": "Nee",
                  "uitkomst": {
                    "niveau": "o",
                    "tekst": "Mail een concrete nieuwe planning met twee datumopties. Zet de klant op oranje en bel opnieuw over [[3 werkdagen]]."
                  }
                }
              ]
            }
          }
        ]
      }
    },
    {
      "id": "scripts-afgekeurd",
      "titel": "Klant keurt scripts niet goed en de opname komt eraan",
      "categorie": "script",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Je lost het zelf op met de klant. Alleen een andere scope wordt rood.",
      "situatie": "De opname nadert en de scripts zijn afgekeurd of nog niet akkoord.",
      "stappen": [
        "Vraag concreet wat er niet goed is.",
        "Pas aan binnen [[2 werkdagen]].",
        "Tweede afkeuring? Plan een belafspraak.",
        "Lukt het niet voor de opname? Verplaats de opname."
      ],
      "naarJarno": "De klant wil een andere aanpak die prijs of pakket raakt.",
      "magZelf": [
        "Scripts herschrijven en de opname verplaatsen."
      ],
      "vastleggen": "Feedback en afgesproken richting.",
      "afgerond": "Alle scripts voor de opname zijn goedgekeurd.",
      "klantbericht": "Hoi [naam], dank voor je reactie. Zullen we kort bellen om de scripts samen door te nemen? Dan zorg ik dat alles op tijd klaar is voor de opname op [datum].",
      "zoekwoorden": "scripts afgekeurd, niet akkoord, goedkeuring scripts, opname komt eraan, tweede keer afgekeurd",
      "keuzehulp": {
        "vraag": "Hoe vaak zijn deze scripts al afgekeurd?",
        "opties": [
          {
            "antwoord": "Eén keer",
            "uitkomst": {
              "niveau": "g",
              "tekst": "Vraag concrete feedback en pas de scripts aan binnen [[2 werkdagen]]."
            }
          },
          {
            "antwoord": "Twee keer of vaker",
            "vervolg": {
              "vraag": "Wil de klant een andere aanpak dan afgesproken?",
              "opties": [
                {
                  "antwoord": "Nee, het gaat om details",
                  "uitkomst": {
                    "niveau": "o",
                    "tekst": "Plan een belafspraak, schrijf samen de richting uit en leg die vast voordat je herschrijft."
                  }
                },
                {
                  "antwoord": "Ja, en het raakt scope of prijs",
                  "uitkomst": {
                    "niveau": "r",
                    "tekst": "Commerciële beslissing. Zet het verschil tussen afspraak en wens in het escalatieformat."
                  }
                }
              ]
            }
          }
        ]
      }
    },
    {
      "id": "scripts-te-laat",
      "titel": "Ik krijg de scripts niet op tijd af",
      "categorie": "script",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Intern op te lossen met prioriteren en planning.",
      "situatie": "De scripts zijn niet klaar op de interne deadline.",
      "stappen": [
        "Prioriteer de scripts die als eerste opgenomen worden.",
        "Vraag je collega om hulp als het nodig is.",
        "Lukt het niet? Verplaats de opname in overleg met klant en videograaf.",
        "Zet de opname op oranje in de Hub."
      ],
      "naarJarno": "De opname vervalt en er zijn al kosten gemaakt.",
      "magZelf": [
        "Prioriteren, hulp vragen en de opname verplaatsen."
      ],
      "vastleggen": "Nieuwe deadline of opnamedatum.",
      "afgerond": "De scripts zijn goedgekeurd voor de opname.",
      "klantbericht": "Hoi [naam], ik wil de scripts graag goed voor je maken en heb daar iets meer tijd voor nodig. Je ontvangt ze uiterlijk [dag]. De opname op [datum] blijft staan.",
      "zoekwoorden": "scripts te laat, niet op tijd, deadline scripts, achter met scripts, scripts niet af"
    },
    {
      "id": "idee-klant",
      "titel": "Klant komt met een eigen idee of onderwerp",
      "categorie": "script",
      "niveau": "g",
      "eigenaar": "cc",
      "waarom": "Onderwerpen kiezen binnen het pakket is jouw werk.",
      "situatie": "De klant komt met een idee voor een video.",
      "stappen": [
        "Toets het aan de strategie en eerdere resultaten.",
        "Past het? Neem het op in de planning, eventueel in plaats van een ander script.",
        "Past het niet? Leg uit waarom en stel een alternatief voor."
      ],
      "naarJarno": "Niet nodig.",
      "magZelf": [
        "Ideeën wel of niet opnemen."
      ],
      "vastleggen": "Idee en keuze in de contentplanning.",
      "afgerond": "De klant weet wat er met het idee gebeurt.",
      "klantbericht": "Hoi [naam], dank voor je idee! Ik neem het mee in de planning voor [maand]. Ik stuur je het script zodra het klaar is.",
      "zoekwoorden": "idee klant, eigen idee, onderwerp, suggestie, nieuw onderwerp, input klant"
    },
    {
      "id": "info-ontbreekt",
      "titel": "Ik mis informatie van de klant",
      "categorie": "script",
      "niveau": "g",
      "eigenaar": "cc",
      "waarom": "Informatie ophalen is jouw voorbereiding.",
      "situatie": "Je mist input voor scripts of gegevens voor de opname (adres, contactpersoon, sprekers).",
      "stappen": [
        "Maak een lijst van wat je mist.",
        "Vraag het in één bericht op met een deadline.",
        "Geen reactie? Bel of plan een belafspraak van [[15 minuten]]."
      ],
      "naarJarno": "Niet nodig.",
      "magZelf": [
        "Informatie opvragen en de planning aanpassen."
      ],
      "vastleggen": "Ontvangen informatie in het klantdossier.",
      "afgerond": "Je kunt verder.",
      "klantbericht": "Hoi [naam], om alles goed voor te bereiden heb ik nog een paar dingen van je nodig: [lijst]. Zou je die uiterlijk [dag] kunnen sturen? Dank je wel!",
      "zoekwoorden": "onvoldoende informatie, mist info, gegevens ontbreken, adres, contactpersoon, opnamegegevens, briefing klant, input"
    },
    {
      "id": "kleine-wijziging",
      "titel": "Klant wil een kleine wijziging in een video",
      "categorie": "editing",
      "niveau": "g",
      "eigenaar": "cc",
      "waarom": "Kleine revisies horen bij de normale procedure.",
      "situatie": "Een tekst, ondertitel, muziek of kleine cut aanpassen.",
      "stappen": [
        "Zet de feedback met tijdcodes bij de editor.",
        "Laat het binnen [[1 werkdag]] aanpassen.",
        "Controleer en stuur de nieuwe versie."
      ],
      "naarJarno": "Niet nodig.",
      "magZelf": [
        "Revisies binnen de revisieprocedure."
      ],
      "vastleggen": "Nieuwe versie in de Hub.",
      "afgerond": "De klant heeft de video goedgekeurd.",
      "klantbericht": "Hoi [naam], dank voor je feedback! We passen het aan en je ontvangt de nieuwe versie uiterlijk [dag].",
      "zoekwoorden": "kleine wijziging, aanpassing, ondertitel, tekst aanpassen, muziek, revisie, cut, feedback video"
    },
    {
      "id": "video-ontevreden",
      "titel": "Klant is ontevreden over een video",
      "categorie": "editing",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Feedback hoort bij het vak. Alleen geld of contract is voor Jarno.",
      "situatie": "De klant vindt een video niet mooi, niet goed genoeg of niet professioneel.",
      "stappen": [
        "Vraag concreet wat er niet goed is, met voorbeelden.",
        "Vergelijk met het script en de style guide.",
        "Laat de editor verbeteren of zet het bij een andere editor.",
        "Bel de klant met de oplossing en een datum."
      ],
      "naarJarno": "De klant vraagt om compensatie, korting of wil stoppen.",
      "magZelf": [
        "Revisies, een nieuwe montage, een andere editor binnen de begroting."
      ],
      "vastleggen": "Feedback en oplossing.",
      "afgerond": "De klant keurt de video goed.",
      "klantbericht": "Hoi [naam], dank dat je dit eerlijk aangeeft. Ik wil het graag goed maken. Kun je me laten weten wat je precies anders wilt zien? Dan passen we het aan en heb je de nieuwe versie uiterlijk [dag].",
      "zoekwoorden": "ontevreden, niet mooi, niet goed, kwaliteit, niet professioneel, slecht, afgekeurd, niet blij, boos video",
      "keuzehulp": {
        "vraag": "Gaat het om normale inhoudelijke feedback of om een ernstige klacht?",
        "opties": [
          {
            "antwoord": "Normale feedback",
            "vervolg": {
              "vraag": "Kan de wijziging binnen de bestaande afspraken en revisieprocedure?",
              "opties": [
                {
                  "antwoord": "Ja",
                  "uitkomst": {
                    "niveau": "g",
                    "tekst": "Dit is gewoon werk."
                  }
                },
                {
                  "antwoord": "Nee, het valt erbuiten",
                  "uitkomst": {
                    "niveau": "o",
                    "tekst": "Controleer wat wel kan. Bied de klant twee alternatieven binnen de afspraken, bijvoorbeeld een andere montage met bestaand materiaal of het idee meenemen in de volgende opname. Leg de keuze vast."
                  }
                }
              ]
            }
          },
          {
            "antwoord": "Ernstige klacht",
            "vervolg": {
              "vraag": "Vraagt de klant om geld terug, korting, stoppen of een contractwijziging?",
              "opties": [
                {
                  "antwoord": "Ja",
                  "uitkomst": {
                    "niveau": "r",
                    "tekst": "Financiële of contractuele beslissing. Vul het escalatieformat in en kom met jouw advies."
                  }
                },
                {
                  "antwoord": "Nee",
                  "uitkomst": {
                    "niveau": "o",
                    "tekst": "Bel de klant binnen [[1 werkdag]]. Erken het probleem, stel een herstelplan voor en spreek een datum af. Lukt dat niet binnen [[5 werkdagen]]? Dan Jarno inschakelen."
                  }
                }
              ]
            }
          }
        ]
      }
    },
    {
      "id": "video-helemaal-anders",
      "titel": "Klant wil een video helemaal anders",
      "categorie": "editing",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Je lost het zelf op, maar het kost editcapaciteit.",
      "situatie": "De klant wil een compleet nieuwe montage of een andere stijl.",
      "stappen": [
        "Vraag om een voorbeeld van wat hij wil.",
        "Check of het binnen de revisieprocedure past.",
        "Plan de nieuwe montage in en pas zo nodig de style guide aan.",
        "Laat de eerste nieuwe versie eerst goedkeuren."
      ],
      "naarJarno": "Het kost meer dan [[2 uur]] extra editwerk of structureel meer werk.",
      "magZelf": [
        "Eén nieuwe montage per video.",
        "De stijl binnen het pakket aanpassen."
      ],
      "vastleggen": "Feedback, nieuwe stijlafspraken en datum.",
      "afgerond": "De nieuwe versie is goedgekeurd.",
      "klantbericht": "Hoi [naam], helder, dank je. Heb je een voorbeeld van een video die je mooi vindt? Dan laten we de nieuwe versie daarop aansluiten en heb je hem uiterlijk [dag].",
      "zoekwoorden": "opnieuw monteren, nieuwe montage, helemaal anders, andere stijl, videostijl, look, format"
    },
    {
      "id": "extra-feedbackronde",
      "titel": "Klant wil een extra feedbackronde",
      "categorie": "editing",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Eén extra ronde mag je zelf geven. Daarboven wordt het meerwerk.",
      "situatie": "De klant wil meer revisierondes dan afgesproken.",
      "stappen": [
        "Bundel alle open feedback in één lijst.",
        "Ken de extra ronde toe als die dit kwartaal nog niet gebruikt is.",
        "Spreek af dat dit de laatste ronde is.",
        "Leg het vast in de Hub."
      ],
      "naarJarno": "De klant wil meerdere extra rondes, of het wordt een vast patroon.",
      "magZelf": [
        "[[Eén extra feedbackronde per klant per kwartaal]]."
      ],
      "vastleggen": "Aantal rondes en de afspraak.",
      "afgerond": "De video is goedgekeurd.",
      "klantbericht": "Hoi [naam], we nemen deze aanpassingen graag nog mee. Zou je alle feedback in één bericht willen sturen? Dan verwerken we het in één keer en is dit de laatste ronde voor deze video.",
      "zoekwoorden": "derde feedbackronde, extra ronde, revisies, feedbackronde, wijzigingen blijven komen, nog een ronde",
      "keuzehulp": {
        "vraag": "Hoeveel revisierondes heeft deze video al gehad?",
        "opties": [
          {
            "antwoord": "Binnen het aantal uit de afspraken",
            "uitkomst": {
              "niveau": "g",
              "tekst": "Gewoon verwerken. Bundel de feedback zodat de editor in één keer kan werken."
            }
          },
          {
            "antwoord": "Eén ronde meer",
            "uitkomst": {
              "niveau": "o",
              "tekst": "Ken de extra ronde toe als die dit kwartaal nog niet gebruikt is. Spreek af dat dit de laatste is."
            }
          },
          {
            "antwoord": "Meerdere rondes meer",
            "uitkomst": {
              "niveau": "r",
              "tekst": "Meer werk dan afgesproken raakt prijs of contract. Lever een overzicht van de rondes aan met jouw voorstel."
            }
          }
        ]
      }
    },
    {
      "id": "feedback-geen-reactie",
      "titel": "Klant geeft geen feedback op een video",
      "categorie": "editing",
      "niveau": "g",
      "eigenaar": "cc",
      "waarom": "Herinneren en publicatie verschuiven doe je zelf.",
      "situatie": "De klant reageert niet binnen [[72 uur]] op een opgeleverde video.",
      "stappen": [
        "Stuur een herinnering met de geplande publicatiedatum.",
        "Geen reactie na [[2 werkdagen]]: bel.",
        "Schuif de publicatie door of zet een andere goedgekeurde video op die plek."
      ],
      "naarJarno": "Geen reactie na [[10 werkdagen]].",
      "magZelf": [
        "Herinneren en publicaties verschuiven."
      ],
      "vastleggen": "Herinneringen en publicatieplanning.",
      "afgerond": "De video is goedgekeurd.",
      "klantbericht": "Hoi [naam], heb je de video al kunnen bekijken? Als ik je akkoord uiterlijk [dag] heb, plaatsen we hem op [datum]. Dank je!",
      "zoekwoorden": "72 uur, geen feedback, reageert niet, video niet goedgekeurd, wacht op akkoord, goedkeuring video"
    },
    {
      "id": "fout-in-video",
      "titel": "Er zit een fout in een video",
      "categorie": "editing",
      "niveau": "g",
      "eigenaar": "cc",
      "waarom": "Een fout herstellen vraagt geen overleg.",
      "situatie": "Spelfout, verkeerd logo, geluid weg, verkeerde versie of verkeerde resolutie.",
      "stappen": [
        "Noteer de fout met tijdcode.",
        "Laat de editor het binnen [[1 werkdag]] herstellen.",
        "Controleer de nieuwe versie voordat die naar de klant gaat."
      ],
      "naarJarno": "Niet nodig, tenzij de video al online staat met schade.",
      "magZelf": [
        "Fouten laten herstellen."
      ],
      "vastleggen": "Nieuwe versie in de Hub.",
      "afgerond": "De juiste versie staat klaar.",
      "klantbericht": "Hoi [naam], goed gezien, dank je! We passen het aan en je ontvangt de juiste versie uiterlijk [dag].",
      "zoekwoorden": "fout, spelfout, typfout, verkeerd logo, geluid weg, verkeerde versie, technische fout, export, resolutie, montagefout"
    },
    {
      "id": "eigen-beeldmateriaal",
      "titel": "Klant wil eigen beelden toevoegen",
      "categorie": "editing",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Je regelt het zelf, maar het kan extra editwerk kosten.",
      "situatie": "De klant wil eigen foto's of video in de montage.",
      "stappen": [
        "Vraag de beelden op en check de kwaliteit.",
        "Check of de editor het kan verwerken.",
        "Plan het in en noem de nieuwe datum."
      ],
      "naarJarno": "Er is een extra opname nodig of meer dan [[2 uur]] extra editwerk.",
      "magZelf": [
        "Aangeleverd materiaal laten verwerken."
      ],
      "vastleggen": "Aangeleverd materiaal en afspraak.",
      "afgerond": "De video met het nieuwe materiaal is goedgekeurd.",
      "klantbericht": "Hoi [naam], leuk! Stuur de beelden gerust via [WeTransfer/Drive]. We verwerken ze en je ontvangt de nieuwe versie uiterlijk [dag].",
      "zoekwoorden": "eigen beelden, beeldmateriaal, footage klant, foto's toevoegen, materiaal aanleveren"
    },
    {
      "id": "briefing-editor",
      "titel": "Editor snapt de briefing niet",
      "categorie": "editing",
      "niveau": "g",
      "eigenaar": "cc",
      "waarom": "Briefen is jouw taak.",
      "situatie": "De editor vraagt om verduidelijking.",
      "stappen": [
        "Beantwoord de vraag dezelfde dag.",
        "Stuur een voorbeeldvideo mee.",
        "Pas de briefing aan zodat de vraag niet terugkomt."
      ],
      "naarJarno": "Niet nodig.",
      "magZelf": [
        "Briefing aanpassen."
      ],
      "vastleggen": "Aangepaste briefing.",
      "afgerond": "De editor kan verder.",
      "klantbericht": null,
      "zoekwoorden": "briefing, onduidelijk, editor vraag, verduidelijking"
    },
    {
      "id": "opname-verplaatsen",
      "titel": "Klant wil een opname verplaatsen of zegt af",
      "categorie": "opname",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Verplaatsen regel je zelf. Kosten doorbelasten is voor Jarno.",
      "situatie": "De klant wil de opnamedag naar een ander moment of zegt af.",
      "stappen": [
        "Check de agenda van de videograaf.",
        "Bied twee nieuwe data aan.",
        "Bevestig de nieuwe datum schriftelijk.",
        "Werk de agenda en de Hub bij.",
        "Gebeurt het vaker bij deze klant? Zet de klant op oranje."
      ],
      "naarJarno": "De klant zegt af binnen [[48 uur]] en er zijn al kosten gemaakt (freelancer, locatie).",
      "magZelf": [
        "Opnames verplaatsen binnen de looptijd."
      ],
      "vastleggen": "Nieuwe datum in agenda en Hub.",
      "afgerond": "De nieuwe opname staat vast en iedereen weet het.",
      "klantbericht": "Hoi [naam], geen probleem, dank voor het laten weten. Ik kan [datum 1] of [datum 2] aanbieden. Welke past jou het beste?",
      "zoekwoorden": "opname verplaatsen, verzetten, andere datum, draaidag verplaatsen, zegt af, afzeggen, annuleren, cancel, afzegging, kan niet",
      "keuzehulp": {
        "vraag": "Wanneer meldt de klant het?",
        "opties": [
          {
            "antwoord": "Meer dan [[48 uur]] van tevoren",
            "uitkomst": {
              "niveau": "g",
              "tekst": "Verplaats de opname en bevestig de nieuwe datum."
            }
          },
          {
            "antwoord": "Binnen [[48 uur]]",
            "vervolg": {
              "vraag": "Zijn er al kosten gemaakt, zoals een freelancer of locatie?",
              "opties": [
                {
                  "antwoord": "Nee",
                  "uitkomst": {
                    "niveau": "o",
                    "tekst": "Verplaats de opname en wijs de klant vriendelijk op de afspraak over verplaatsen."
                  }
                },
                {
                  "antwoord": "Ja",
                  "uitkomst": {
                    "niveau": "r",
                    "tekst": "Plan alvast een nieuwe datum. Of de kosten worden doorbelast, beslist Jarno."
                  }
                }
              ]
            }
          },
          {
            "antwoord": "Op de dag zelf",
            "uitkomst": {
              "niveau": "r",
              "tekst": "Informeer de videograaf direct en plan een nieuwe datum. Noteer de gemaakte kosten. Jarno beslist over doorbelasten."
            }
          }
        ]
      }
    },
    {
      "id": "klant-afwezig",
      "titel": "Klant is er niet bij de opname",
      "categorie": "opname",
      "niveau": "o",
      "eigenaar": "vg",
      "waarom": "Op locatie los je het op. Alleen doorbelasten is voor Jarno.",
      "situatie": "De videograaf staat er en de klant is er niet.",
      "stappen": [
        "Bel de klant.",
        "Wacht maximaal [[30 minuten]].",
        "Niet bereikbaar? Vertrek en meld het aan de Content Creative.",
        "De Content Creative plant een nieuwe datum."
      ],
      "naarJarno": "De verloren dag moet mogelijk worden doorbelast.",
      "magZelf": [
        "Wachten, vertrekken en een nieuwe datum plannen."
      ],
      "vastleggen": "Tijdstip, belpogingen en nieuwe datum.",
      "afgerond": "De nieuwe opname staat vast.",
      "klantbericht": "Hoi [naam], onze videograaf stond om [tijd] voor de opname bij jullie klaar, maar we konden niemand bereiken. Alles goed? Laten we een nieuwe datum prikken: past [datum 1] of [datum 2]?",
      "zoekwoorden": "niet aanwezig, niemand, no show, niet komen opdagen, klant afwezig, staat voor dichte deur"
    },
    {
      "id": "klant-niet-klaar",
      "titel": "Klant is te laat of niet voorbereid",
      "categorie": "opname",
      "niveau": "g",
      "eigenaar": "vg",
      "waarom": "De videograaf stuurt de draaidag.",
      "situatie": "De klant komt later, kent de scripts niet of heeft niets geregeld.",
      "stappen": [
        "Begin met wat al kan, zoals b-roll.",
        "Neem [[15 minuten]] om de scripts samen door te nemen.",
        "Begin met de makkelijkste video's en prioriteer.",
        "Meld na afloop aan de Content Creative wat er is opgenomen."
      ],
      "naarJarno": "Niet nodig. Mist er daardoor veel? Zie 'Er mist beeld of geluid na de opname'.",
      "magZelf": [
        "Volgorde, aanpak en tekst op locatie aanpassen.",
        "Minder opnemen als de kwaliteit anders lijdt."
      ],
      "vastleggen": "Wat er is opgenomen.",
      "afgerond": "De opname is afgerond.",
      "klantbericht": null,
      "zoekwoorden": "te laat, niet voorbereid, onvoorbereid, scripts niet geleerd, niets geregeld, presentator afwezig"
    },
    {
      "id": "locatie-probleem",
      "titel": "Locatie gaat niet (bezet, andere wens of slecht weer)",
      "categorie": "opname",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Een praktisch probleem met praktische oplossingen.",
      "situatie": "De geplande plek kan niet, de klant wil last minute ergens anders of het weer zit tegen.",
      "stappen": [
        "Vraag de klant naar een andere plek, binnen of buiten.",
        "Check met de videograaf of de scripts daar werken.",
        "Haalbaar? Doorvoeren. Niet? Verplaats de opname.",
        "Informeer klant en videograaf."
      ],
      "naarJarno": "Een vervangende locatie of extra reistijd kost meer dan [[€250]].",
      "magZelf": [
        "Een andere plek kiezen, scripts aanpassen, verplaatsen."
      ],
      "vastleggen": "Nieuwe locatie of datum.",
      "afgerond": "De opname is uitgevoerd.",
      "klantbericht": "Hoi [naam], [locatie] blijkt op [datum] helaas niet te kunnen. Kunnen we uitwijken naar [alternatief]? Anders plannen we een nieuwe datum, bijvoorbeeld [datum].",
      "zoekwoorden": "locatie, plek, niet beschikbaar, ruimte bezet, andere locatie, weer, regen, storm, buiten"
    },
    {
      "id": "opname-loopt-uit",
      "titel": "Opname loopt uit",
      "categorie": "opname",
      "niveau": "o",
      "eigenaar": "vg",
      "waarom": "Beperkte uitloop hoort bij een draaidag.",
      "situatie": "De opname duurt langer dan gepland.",
      "stappen": [
        "Bespreek met de klant wat prioriteit heeft.",
        "Uitloop tot [[1 uur]]: afmaken.",
        "Meer? Neem het belangrijkste op en plan de rest later.",
        "Meld het aan de Content Creative."
      ],
      "naarJarno": "Meer dan [[1 uur]] uitloop en een vraag over doorbelasten.",
      "magZelf": [
        "Tot [[1 uur]] uitlopen."
      ],
      "vastleggen": "Werkelijke duur.",
      "afgerond": "Alles is opgenomen of opnieuw ingepland.",
      "klantbericht": null,
      "zoekwoorden": "uitloop, loopt uit, duurt lang, langer, overtijd"
    },
    {
      "id": "script-onuitvoerbaar",
      "titel": "Script werkt niet op locatie",
      "categorie": "opname",
      "niveau": "g",
      "eigenaar": "vg",
      "waarom": "Op locatie beslist de videograaf hoe het wel kan.",
      "situatie": "Op de opnamedag blijkt een script niet te kunnen.",
      "stappen": [
        "Pas het script ter plekke aan met de klant.",
        "Kan dat niet? Neem een ander script op.",
        "Meld het na afloop aan de Content Creative."
      ],
      "naarJarno": "Niet nodig.",
      "magZelf": [
        "Scripts op locatie aanpassen of vervangen."
      ],
      "vastleggen": "Wat er is aangepast.",
      "afgerond": "De opname is afgerond.",
      "klantbericht": null,
      "zoekwoorden": "onuitvoerbaar, kan niet op locatie, script werkt niet, past niet"
    },
    {
      "id": "materiaal-mist",
      "titel": "Er mist beeld of geluid na de opname",
      "categorie": "opname",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Oplossen met de planning. Een extra dag met kosten is voor Jarno.",
      "situatie": "Een shot is vergeten, er is geen geluid, of er zijn minder video's opgenomen dan gepland.",
      "stappen": [
        "Check wat er precies mist.",
        "Kan de video met ander beeld, voice-over of ondertiteling?",
        "Kan het niet? Neem het mee bij de volgende opname.",
        "Informeer de klant over de gevolgen voor de oplevering."
      ],
      "naarJarno": "Er is een extra draaidag nodig met kosten, of de klant krijgt minder video's dan in het contract staat.",
      "magZelf": [
        "Montage aanpassen of later opnemen."
      ],
      "vastleggen": "Wat ontbrak en de oplossing.",
      "afgerond": "De video's zijn compleet.",
      "klantbericht": "Hoi [naam], bij het monteren zagen we dat [onderdeel] niet goed is vastgelegd. Dat nemen we mee bij de volgende opname op [datum], zodat je alle video's krijgt zoals afgesproken.",
      "zoekwoorden": "shot vergeten, beeld mist, geen geluid, microfoon, audio, materiaal ontbreekt, minder video's opgenomen, opnieuw opnemen, heropname",
      "keuzehulp": {
        "vraag": "Bij wie ligt de oorzaak?",
        "opties": [
          {
            "antwoord": "Bij Shortclips",
            "vervolg": {
              "vraag": "Past de heropname in een bestaande opnamedag?",
              "opties": [
                {
                  "antwoord": "Ja",
                  "uitkomst": {
                    "niveau": "g",
                    "tekst": "Neem het mee bij de volgende opname. Informeer de klant over de nieuwe opleverdatum."
                  }
                },
                {
                  "antwoord": "Nee, er is een extra dag nodig",
                  "uitkomst": {
                    "niveau": "o",
                    "tekst": "Plan een extra dag in als die binnen de begroting past en onder [[€250]] blijft. Anders Jarno inschakelen."
                  }
                }
              ]
            }
          },
          {
            "antwoord": "Bij de klant",
            "uitkomst": {
              "niveau": "r",
              "tekst": "Een extra draaidag voor rekening van de klant is een financiële beslissing. Lever het escalatieformat aan met jouw advies."
            }
          }
        ]
      }
    },
    {
      "id": "apparatuur-uitval",
      "titel": "Camera of apparatuur valt uit",
      "categorie": "opname",
      "niveau": "o",
      "eigenaar": "vg",
      "waarom": "De videograaf lost het op locatie op.",
      "situatie": "De camera, microfoon of lamp werkt niet meer tijdens de opname.",
      "stappen": [
        "Schakel over op reserve-apparatuur of telefoon.",
        "Lukt het niet? Plan de rest opnieuw in.",
        "Meld het aan de Content Creative."
      ],
      "naarJarno": "Er is nieuwe apparatuur of een extra dag met kosten nodig.",
      "magZelf": [
        "Overschakelen en opnieuw inplannen."
      ],
      "vastleggen": "Wat er gebeurde.",
      "afgerond": "De opname is afgerond of opnieuw gepland.",
      "klantbericht": null,
      "zoekwoorden": "camera, uitval, kapot, apparatuur, accu, lamp, microfoon kapot"
    },
    {
      "id": "bestanden-kwijt",
      "titel": "Opnamebestanden zijn kwijt of beschadigd",
      "categorie": "opname",
      "niveau": "r",
      "eigenaar": "bi",
      "waarom": "Mogelijk een extra draaidag en kosten.",
      "situatie": "Materiaal blijkt kapot of kwijt.",
      "stappen": [
        "Check back-ups en de kaarten.",
        "Bepaal wat verloren is.",
        "Leg het voor aan Jarno met een voorstel voor heropname."
      ],
      "naarJarno": "Altijd: kom met een voorstel en leg het voor aan Jarno.",
      "magZelf": [
        "Herstellen proberen."
      ],
      "vastleggen": "Wat verloren is.",
      "afgerond": "Er is een oplossing en de klant is geïnformeerd.",
      "klantbericht": null,
      "zoekwoorden": "beschadigd, kapot, bestanden kwijt, corrupt, kaart, data weg",
      "voorbereiding": "cc"
    },
    {
      "id": "levering-te-laat",
      "titel": "Video wordt later geleverd dan afgesproken",
      "categorie": "deadline",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Je lost het zelf op met planning. Compensatie is voor Jarno.",
      "situatie": "De levertijd van [[14 werkdagen]] of een publicatiedatum wordt niet gehaald.",
      "stappen": [
        "Zoek de oorzaak.",
        "Verdeel het werk over een andere editor als dat kan.",
        "Informeer de klant voordat de deadline verstrijkt, met een nieuwe datum.",
        "Zet een andere goedgekeurde video op de publicatieplek."
      ],
      "naarJarno": "Meer dan [[5 werkdagen]] te laat, of de klant wil compensatie.",
      "magZelf": [
        "Werk herverdelen en de datum [[maximaal 2 werkdagen]] verschuiven."
      ],
      "vastleggen": "Oorzaak en nieuwe datum.",
      "afgerond": "De video is opgeleverd.",
      "klantbericht": "Hoi [naam], ik wil je even laten weten dat de video's iets later klaar zijn dan gepland. Je ontvangt ze uiterlijk [datum]. Excuses voor het ongemak, we doen ons best om het zo snel mogelijk af te ronden.",
      "zoekwoorden": "14 werkdagen, te laat, levertijd, vertraging, deadline, waarom vertraagd, wanneer klaar, publicatiedatum"
    },
    {
      "id": "editor-te-laat",
      "titel": "Editor levert te laat of reageert niet",
      "categorie": "deadline",
      "niveau": "g",
      "eigenaar": "cc",
      "waarom": "Werk herverdelen kun je zelf. Extra budget niet.",
      "situatie": "Een editor haalt de deadline niet of is niet bereikbaar.",
      "stappen": [
        "Vraag de nieuwe datum en de reden. Geen reactie? Bel na [[4 uur]].",
        "Past het nog binnen de klantdeadline? Accepteren.",
        "Past het niet of geen reactie na [[1 werkdag]]? Zet het bij een andere editor.",
        "Leg de vertraging vast bij de editor."
      ],
      "naarJarno": "Er is extra budget nodig voor een andere editor.",
      "magZelf": [
        "Werk herverdelen binnen de begroting."
      ],
      "vastleggen": "Vertraging bij de editor in de Hub.",
      "afgerond": "De video is opgeleverd.",
      "klantbericht": null,
      "zoekwoorden": "editor te laat, deadline gemist, montage vertraagd, editor achter, editor reageert niet, editor onbereikbaar",
      "keuzehulp": {
        "vraag": "Haalt de video de klantdeadline nog?",
        "opties": [
          {
            "antwoord": "Ja",
            "uitkomst": {
              "niveau": "g",
              "tekst": "Accepteer de nieuwe datum, werk de planning bij en leg de vertraging vast."
            }
          },
          {
            "antwoord": "Nee, maar binnen [[2 werkdagen]] uitloop",
            "uitkomst": {
              "niveau": "o",
              "tekst": "Informeer de klant met de nieuwe datum, of verdeel het werk over een andere editor."
            }
          },
          {
            "antwoord": "Nee, meer dan [[2 werkdagen]] uitloop",
            "vervolg": {
              "vraag": "Kan een andere editor het binnen de begroting oppakken?",
              "opties": [
                {
                  "antwoord": "Ja",
                  "uitkomst": {
                    "niveau": "o",
                    "tekst": "Zet het werk over, brief de nieuwe editor en informeer de klant."
                  }
                },
                {
                  "antwoord": "Nee",
                  "uitkomst": {
                    "niveau": "r",
                    "tekst": "Extra kosten buiten de begroting. Noem de opties en kosten in het escalatieformat."
                  }
                }
              ]
            }
          }
        ]
      }
    },
    {
      "id": "spoed",
      "titel": "Klant wil een video sneller",
      "categorie": "deadline",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Je regelt het zelf als er capaciteit is. Extra kosten niet.",
      "situatie": "De klant wil spoed of video's eerder ontvangen.",
      "stappen": [
        "Vraag naar de reden en de uiterste datum.",
        "Check bij de editor of er ruimte is.",
        "Meerdere spoedvragen tegelijk? Prioriteer met je collega.",
        "Kan het? Inplannen. Kan het niet? Bied de eerst mogelijke datum aan."
      ],
      "naarJarno": "Spoed kost extra, bijvoorbeeld een freelancer buiten de begroting.",
      "magZelf": [
        "Spoed inplannen als het past."
      ],
      "vastleggen": "Afgesproken datum.",
      "afgerond": "De video is op tijd geleverd.",
      "klantbericht": "Hoi [naam], ik begrijp dat je hem graag snel hebt. Ik check het direct bij onze editor en laat je vandaag nog weten of [datum] haalbaar is.",
      "zoekwoorden": "spoed, haast, sneller, urgent, snel nodig, eerder, morgen nodig"
    },
    {
      "id": "vaste-datum",
      "titel": "Klant heeft een video op een vaste datum nodig",
      "categorie": "deadline",
      "niveau": "g",
      "eigenaar": "cc",
      "waarom": "Plannen is jouw werk.",
      "situatie": "De klant wil een video voor een event of actie.",
      "stappen": [
        "Zet de datum als deadline in de Hub.",
        "Plan opname en montage terug vanaf die datum.",
        "Bevestig de datum aan de klant."
      ],
      "naarJarno": "Niet nodig.",
      "magZelf": [
        "Planning afstemmen op de datum."
      ],
      "vastleggen": "Deadline in de Hub.",
      "afgerond": "De video is op de datum geleverd.",
      "klantbericht": "Hoi [naam], top, genoteerd! We zorgen dat de video uiterlijk [datum] klaarstaat.",
      "zoekwoorden": "vaste datum, event, actie, deadline klant, specifieke datum"
    },
    {
      "id": "extra-video",
      "titel": "Klant wil een extra video",
      "categorie": "aantal",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Een losse extra video tegen de vaste prijs regel je zelf. Een afwijkende prijs niet.",
      "situatie": "De klant wil een video bovenop het pakket.",
      "stappen": [
        "Check of een geplande video kan worden omgewisseld.",
        "Echt extra? Bied aan tegen [[de vaste prijs]].",
        "Check opname- en editcapaciteit.",
        "Bevestig pas na akkoord van de klant en leg het vast."
      ],
      "naarJarno": "Gratis, een afwijkende prijs of structureel meer.",
      "magZelf": [
        "Omwisselen en een losse extra video tegen [[de vaste prijs]]."
      ],
      "vastleggen": "Afspraak en prijs.",
      "afgerond": "De extra video is ingepland.",
      "klantbericht": "Hoi [naam], leuk dat je er nog een video bij wilt! Een extra video kost [[de vaste prijs]]. Zal ik hem inplannen? Dan stuur ik je het script uiterlijk [dag].",
      "zoekwoorden": "extra video, nog een video, bijbestellen, meer video, losse video",
      "keuzehulp": {
        "vraag": "Wat wil de klant precies?",
        "opties": [
          {
            "antwoord": "Een video omwisselen binnen het pakket",
            "uitkomst": {
              "niveau": "g",
              "tekst": "Wissel om, pas de planning aan en informeer het team."
            }
          },
          {
            "antwoord": "Eenmalig een extra video",
            "uitkomst": {
              "niveau": "o",
              "tekst": "Bied de extra video aan tegen [[de vaste prijs]]. Wijkt de klant af van die prijs? Dan wordt het rood."
            }
          },
          {
            "antwoord": "Structureel meer video's",
            "uitkomst": {
              "niveau": "r",
              "tekst": "Dit wijzigt de overeenkomst. Lever het escalatieformat aan met het gewenste aantal en jouw prijsvoorstel."
            }
          }
        ]
      }
    },
    {
      "id": "videos-meenemen",
      "titel": "Klant wil video's meenemen naar de volgende maand",
      "categorie": "aantal",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Doorschuiven kun je zelf, binnen de grens.",
      "situatie": "De klant heeft video's niet gebruikt en wil ze later.",
      "stappen": [
        "Check hoeveel video's openstaan.",
        "Plan ze in de volgende maand.",
        "Leg vast hoeveel er zijn meegenomen."
      ],
      "naarJarno": "Langer doorschuiven of meenemen na het einde van het contract.",
      "magZelf": [
        "[[Maximaal 1 maand]] doorschuiven binnen de looptijd."
      ],
      "vastleggen": "Aantal meegenomen video's.",
      "afgerond": "De video's zijn ingepland.",
      "klantbericht": "Hoi [naam], dat kan. We nemen [aantal] video's mee naar [maand] en plannen ze daar in.",
      "zoekwoorden": "ongebruikt, meenemen, doorschuiven, tegoed, over, volgende maand"
    },
    {
      "id": "extra-opname",
      "titel": "Klant wil een extra opname",
      "categorie": "aantal",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Een extra moment binnen het pakket regel je zelf. Een extra dag kost geld.",
      "situatie": "De klant wil een extra opnamemoment.",
      "stappen": [
        "Check of het binnen het pakket past.",
        "Past het? Plan het in.",
        "Extra draaidag nodig? Leg het voor aan Jarno met een prijsvoorstel."
      ],
      "naarJarno": "Een extra draaidag buiten het pakket.",
      "magZelf": [
        "Een extra draaimoment binnen het pakket."
      ],
      "vastleggen": "Afspraak.",
      "afgerond": "De opname staat gepland.",
      "klantbericht": "Hoi [naam], goed idee! Ik kijk wat er past en kom er uiterlijk [dag] bij je op terug met een voorstel.",
      "zoekwoorden": "extra opname, extra draaidag, nog een opname, extra opnamedag"
    },
    {
      "id": "pakket-wijzigen",
      "titel": "Klant wil meer, minder of tijdelijk geen video's",
      "categorie": "aantal",
      "niveau": "r",
      "eigenaar": "bi",
      "waarom": "Het wijzigt prijs en contract.",
      "situatie": "De klant wil het pakket uitbreiden, verkleinen, een ander pakket of een maand pauze.",
      "stappen": [
        "Stuur de klant het wachtbericht.",
        "Vraag naar de reden en de gewenste ingangsdatum.",
        "Check de gevolgen voor de planning.",
        "Leg het voor aan Jarno met jouw advies."
      ],
      "naarJarno": "Altijd: kom met een voorstel en leg het voor aan Jarno.",
      "magZelf": [
        "Navragen en voorbereiden."
      ],
      "vastleggen": "Verzoek en reden.",
      "afgerond": "Jarno heeft besloten en het pakket staat goed in de Hub.",
      "klantbericht": "Hoi [naam], dank voor je bericht. Ik bespreek het intern en kom er uiterlijk [dag] bij je op terug.",
      "zoekwoorden": "meer video's, minder video's, pakket, ander pakket, uitbreiden, afschalen, pauze, maand overslaan, pauzeren, abonnement, upgraden, downgraden",
      "voorbereiding": "cc"
    },
    {
      "id": "resultaten",
      "titel": "Klant vraagt naar resultaten of vindt ze tegenvallen",
      "categorie": "klacht",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Uitleggen en bijsturen is jouw expertise. Geld of stoppen niet.",
      "situatie": "Weinig views, weinig aanvragen, of de klant wil gewoon weten hoe het gaat.",
      "stappen": [
        "Haal de cijfers op.",
        "Vergelijk met de doelen uit de kick-off.",
        "Geef drie inzichten en twee concrete aanpassingen.",
        "Twijfelt de klant? Plan een gesprek van maximaal [[30 minuten]]."
      ],
      "naarJarno": "De klant wil compensatie of stoppen.",
      "magZelf": [
        "Cijfers delen, uitleggen en de strategie bijsturen.",
        "Een extra adviesgesprek tot [[30 minuten]]."
      ],
      "vastleggen": "Analyse en afspraken.",
      "afgerond": "De klant heeft de cijfers en een plan.",
      "klantbericht": "Hoi [naam], goede vraag. Ik zet de cijfers voor je op een rij en stuur je uiterlijk [dag] een korte update met wat we zien en wat we de komende periode anders doen.",
      "zoekwoorden": "resultaten, views, laag, weinig views, weinig aanvragen, geen leads, cijfers, statistieken, tegenvallen, werkt niet, rapportage",
      "keuzehulp": {
        "vraag": "Wat wil de klant?",
        "opties": [
          {
            "antwoord": "Gewoon weten hoe het gaat",
            "uitkomst": {
              "niveau": "g",
              "tekst": "Stuur de cijfers met drie korte inzichten."
            }
          },
          {
            "antwoord": "Hij vindt het tegenvallen",
            "uitkomst": {
              "niveau": "o",
              "tekst": "Maak een korte analyse, stel twee aanpassingen voor en plan zo nodig een gesprek."
            }
          },
          {
            "antwoord": "Hij wil compensatie of stoppen",
            "uitkomst": {
              "niveau": "r",
              "tekst": "Maak eerst de analyse, die heeft Jarno nodig. Stuur de klant het wachtbericht."
            }
          }
        ]
      }
    },
    {
      "id": "communicatie",
      "titel": "Klant vindt de communicatie onvoldoende",
      "categorie": "klacht",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Jij bent het aanspreekpunt, dus jij herstelt het.",
      "situatie": "De klant vindt dat er te traag of te weinig gecommuniceerd wordt.",
      "stappen": [
        "Bel de klant, niet per bericht.",
        "Vat samen wat er misging.",
        "Spreek een vast contactritme af.",
        "Houd je er de komende [[4 weken]] strikt aan."
      ],
      "naarJarno": "Een formele klacht of de klant dreigt te stoppen.",
      "magZelf": [
        "Excuses maken en een contactritme afspreken."
      ],
      "vastleggen": "Klacht en nieuw ritme.",
      "afgerond": "De klant is tevreden over het contact.",
      "klantbericht": "Hoi [naam], dank dat je dit aangeeft, daar heb je gelijk in. Ik bel je graag even om af te spreken hoe we je voortaan beter op de hoogte houden. Schikt [dag/tijd]?",
      "zoekwoorden": "communicatie, slecht bereikbaar, traag, onduidelijk, hoor niks, niet op de hoogte"
    },
    {
      "id": "klacht-videograaf",
      "titel": "Klant heeft een klacht over de videograaf",
      "categorie": "klacht",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Je handelt het zelf af met de klant en de videograaf.",
      "situatie": "De klant is ontevreden over de videograaf.",
      "stappen": [
        "Vraag concreet wat er gebeurde.",
        "Bespreek het met de videograaf.",
        "Laat de klant weten wat er verandert.",
        "Plan zo nodig een andere videograaf in."
      ],
      "naarJarno": "Ernstig gedrag of een herhaalde klacht.",
      "magZelf": [
        "Feedback geven en een andere videograaf inplannen."
      ],
      "vastleggen": "Klacht en afspraken.",
      "afgerond": "De klant is tevreden.",
      "klantbericht": "Hoi [naam], vervelend om te horen en dank dat je het meldt. Ik ga het met [videograaf] bespreken en laat je uiterlijk [dag] weten wat we eraan doen.",
      "zoekwoorden": "klacht videograaf, cameraman, gedrag videograaf"
    },
    {
      "id": "dreigt-stoppen",
      "titel": "Klant dreigt te stoppen",
      "categorie": "klacht",
      "niveau": "r",
      "eigenaar": "bi",
      "waarom": "Groot risico op omzetverlies.",
      "situatie": "De klant zegt dat hij stopt als er niets verandert, of overweegt een ander bureau.",
      "stappen": [
        "Bel de klant en vraag wat er moet veranderen.",
        "Bedenk twee oplossingen binnen jouw bevoegdheid.",
        "Doe geen financiële toezeggingen.",
        "Leg het binnen [[1 werkdag]] voor aan Jarno."
      ],
      "naarJarno": "Altijd informeren.",
      "magZelf": [
        "Oplossingen binnen je bevoegdheid direct uitvoeren."
      ],
      "vastleggen": "Signalen en voorstellen.",
      "afgerond": "Jarno heeft besloten en de klant heeft een plan.",
      "klantbericht": "Hoi [naam], dank dat je zo eerlijk bent. Ik wil dit graag goed oplossen. Ik bespreek het intern en kom er uiterlijk [dag] bij je op terug met een concreet voorstel.",
      "zoekwoorden": "dreigt te stoppen, ultimatum, anders stop ik, concurrent, ander bureau, overstappen, twijfelt",
      "voorbereiding": "cc"
    },
    {
      "id": "ernstige-klacht",
      "titel": "Klant zegt dat afspraken niet zijn nagekomen",
      "categorie": "klacht",
      "niveau": "r",
      "eigenaar": "bi",
      "waarom": "Kan leiden tot claims en stoppen.",
      "situatie": "Een ernstige klacht die niet met revisies op te lossen is.",
      "stappen": [
        "Zet de afspraken en wat geleverd is op een rij.",
        "Erken wat misging zonder iets toe te zeggen.",
        "Leg het voor aan Jarno met de tijdlijn."
      ],
      "naarJarno": "Altijd: kom met een voorstel en leg het voor aan Jarno.",
      "magZelf": [
        "Feiten verzamelen."
      ],
      "vastleggen": "Tijdlijn en afspraken.",
      "afgerond": "Jarno heeft besloten en de klant heeft een reactie.",
      "klantbericht": "Hoi [naam], dank dat je dit aangeeft. Ik neem het serieus en zoek het goed voor je uit. Je hoort uiterlijk [dag] van ons.",
      "zoekwoorden": "afspraken niet nagekomen, ernstige klacht, beloofd, niet geleverd, formele klacht, boos",
      "voorbereiding": "cc"
    },
    {
      "id": "andere-cc",
      "titel": "Klant wil een ander aanspreekpunt",
      "categorie": "klacht",
      "niveau": "r",
      "eigenaar": "bi",
      "waarom": "Het raakt de klantrelatie en de teamverdeling.",
      "situatie": "De klant wil een andere Content Creative.",
      "stappen": [
        "Vraag rustig naar de reden.",
        "Neem het niet persoonlijk.",
        "Leg het voor aan Jarno."
      ],
      "naarJarno": "Altijd: kom met een voorstel en leg het voor aan Jarno.",
      "magZelf": [
        "Luisteren."
      ],
      "vastleggen": "Verzoek en reden.",
      "afgerond": "Jarno heeft besloten.",
      "klantbericht": "Hoi [naam], dank voor je eerlijkheid. Ik bespreek het intern en we komen er uiterlijk [dag] bij je op terug.",
      "zoekwoorden": "andere contactpersoon, ander aanspreekpunt, andere content creative, andere projectmanager",
      "voorbereiding": "cc"
    },
    {
      "id": "video-scoort-slecht",
      "titel": "Video scoort slecht",
      "categorie": "social",
      "niveau": "g",
      "eigenaar": "cc",
      "waarom": "Leren van cijfers is jouw werk.",
      "situatie": "Een video blijft achter bij het gemiddelde.",
      "stappen": [
        "Bekijk hook, eerste seconden en kijkduur.",
        "Noteer de les in het klantdossier.",
        "Pas het toe in de volgende scripts."
      ],
      "naarJarno": "Niet nodig.",
      "magZelf": [
        "Strategie bijsturen."
      ],
      "vastleggen": "Les in het klantdossier.",
      "afgerond": "De les is verwerkt.",
      "klantbericht": null,
      "zoekwoorden": "slecht gescoord, weinig views, flop, presteert niet, presteert minder"
    },
    {
      "id": "viraal",
      "titel": "Video gaat viraal",
      "categorie": "social",
      "niveau": "g",
      "eigenaar": "cc",
      "waarom": "Kansen benutten is jouw werk.",
      "situatie": "Een video doet het veel beter dan normaal.",
      "stappen": [
        "Laat het de klant direct weten.",
        "Reageer op comments.",
        "Plan een vervolgvideo in dezelfde stijl.",
        "Deel het intern als succes."
      ],
      "naarJarno": "Niet nodig.",
      "magZelf": [
        "Vervolgcontent plannen."
      ],
      "vastleggen": "Succes in het dossier.",
      "afgerond": "Er staat vervolgcontent gepland.",
      "klantbericht": "Hoi [naam], goed nieuws: je video over [onderwerp] gaat hard, al [aantal] views! We plannen er snel een vervolg op.",
      "zoekwoorden": "viraal, veel views, succes, hit, gaat hard"
    },
    {
      "id": "planning-strategie",
      "titel": "Klant wil andere posttijden of een andere strategie",
      "categorie": "social",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Bijsturen binnen het pakket kun je zelf. Een andere dienst niet.",
      "situatie": "De klant wil op andere momenten posten of een andere contentaanpak.",
      "stappen": [
        "Vraag wat hij wil bereiken.",
        "Posttijden: pas ze direct aan.",
        "Strategie: stel een aanpassing voor binnen het pakket.",
        "Leg de nieuwe afspraken vast."
      ],
      "naarJarno": "Het vraagt een andere dienst of een groter pakket.",
      "magZelf": [
        "Posttijden en strategie binnen het pakket aanpassen."
      ],
      "vastleggen": "Nieuwe afspraken.",
      "afgerond": "De klant heeft ingestemd.",
      "klantbericht": "Hoi [naam], helder, dank je. Ik werk een aangepast voorstel uit en stuur het je uiterlijk [dag].",
      "zoekwoorden": "posttijd, publicatietijd, tijdstip, strategie, contentstrategie, aanpak, richting, andere kanalen"
    },
    {
      "id": "negatieve-reacties",
      "titel": "Klant krijgt negatieve reacties",
      "categorie": "social",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Je handelt het zelf af. Reputatieschade is voor Jarno.",
      "situatie": "Er komen negatieve comments op een video.",
      "stappen": [
        "Beoordeel: normale kritiek of serieus probleem?",
        "Normaal: laat staan of reageer rustig.",
        "Serieus: overleg direct met de klant over offline halen."
      ],
      "naarJarno": "Er dreigt reputatieschade of een juridisch probleem.",
      "magZelf": [
        "Reageren, verbergen of offline halen in overleg met de klant."
      ],
      "vastleggen": "Wat er is gedaan.",
      "afgerond": "De situatie is rustig.",
      "klantbericht": "Hoi [naam], we zien een paar negatieve reacties onder [video]. Zullen we [voorstel] doen? Laat me weten wat jij prettig vindt.",
      "zoekwoorden": "negatieve reacties, comments, haat, kritiek, shitstorm, nare reacties"
    },
    {
      "id": "fout-online",
      "titel": "Er staat iets verkeerds online",
      "categorie": "social",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Direct herstellen doe je zelf. Bij privacy of reputatieschade gaat het naar Jarno.",
      "situatie": "Verkeerde video, caption, cover of zelfs het verkeerde account.",
      "stappen": [
        "Haal de post direct offline of pas hem aan.",
        "Plaats de juiste versie.",
        "Informeer de klant dezelfde dag, ook als hij het nog niet zag.",
        "Leg de oorzaak vast en voorkom herhaling."
      ],
      "naarJarno": "Privacy, juridische of reputatieschade.",
      "magZelf": [
        "Posts aanpassen, verwijderen en opnieuw plaatsen."
      ],
      "vastleggen": "Fout, actie en tijdstip.",
      "afgerond": "De juiste versie staat online en de klant weet het.",
      "klantbericht": "Hoi [naam], vandaag stond er per ongeluk [wat] online. We hebben het direct aangepast en de juiste versie geplaatst. Excuses daarvoor.",
      "zoekwoorden": "verkeerd geplaatst, fout gepost, verkeerde video online, verkeerd account, verkeerde klant, caption fout, foute post",
      "keuzehulp": {
        "vraag": "Wat voor fout is het?",
        "opties": [
          {
            "antwoord": "Spelfout, verkeerde cover of caption",
            "uitkomst": {
              "niveau": "g",
              "tekst": "Pas de post aan of vervang hem binnen [[2 uur]] en informeer de klant."
            }
          },
          {
            "antwoord": "Verkeerde video of verkeerd account",
            "uitkomst": {
              "niveau": "o",
              "tekst": "Verwijder de post direct, publiceer de juiste video en bel de klant dezelfde dag."
            }
          },
          {
            "antwoord": "Privacy, juridisch, veiligheid of reputatie",
            "uitkomst": {
              "niveau": "r",
              "tekst": "Haal de post direct offline. Bel daarna Jarno. Pas na overleg contact met de klant over de vervolgstappen."
            }
          }
        ]
      }
    },
    {
      "id": "offline-halen",
      "titel": "Klant wil een video direct offline",
      "categorie": "social",
      "niveau": "g",
      "eigenaar": "cc",
      "waarom": "Het account is van de klant. Je voert het uit.",
      "situatie": "De klant wil een video meteen weg.",
      "stappen": [
        "Haal de video offline.",
        "Vraag waarom.",
        "Leg vast dat de video vervalt of vervangen wordt."
      ],
      "naarJarno": "Niet nodig.",
      "magZelf": [
        "Offline halen."
      ],
      "vastleggen": "Welke video en waarom.",
      "afgerond": "De video is offline.",
      "klantbericht": "Hoi [naam], de video staat offline. Mag ik vragen waarom? Dan nemen we dat mee voor de volgende video's.",
      "zoekwoorden": "offline, verwijderen, weghalen, video weg, eraf halen"
    },
    {
      "id": "extra-rapportage",
      "titel": "Klant wil extra rapportage",
      "categorie": "social",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Een losse update geef je zelf. Structureel extra werk niet.",
      "situatie": "De klant wil vaker of uitgebreider rapportage.",
      "stappen": [
        "Check wat in het pakket zit.",
        "Kort overzicht: zelf maken.",
        "Structureel extra: leg het voor aan Jarno."
      ],
      "naarJarno": "Structureel extra rapportage.",
      "magZelf": [
        "Een losse extra update."
      ],
      "vastleggen": "Afspraak.",
      "afgerond": "De klant heeft de rapportage.",
      "klantbericht": "Hoi [naam], ik stuur je uiterlijk [dag] een kort overzicht van de cijfers.",
      "zoekwoorden": "rapportage, rapport, extra update, vaker cijfers, maandrapport"
    },
    {
      "id": "factuurvraag",
      "titel": "Klant heeft een vraag over een factuur",
      "categorie": "factuur",
      "niveau": "g",
      "eigenaar": "cc",
      "waarom": "Administratie, geen financiële beslissing.",
      "situatie": "Wanneer komt de factuur, een kopie, een ander adres of uitleg over een regel.",
      "stappen": [
        "Zoek de factuur en de afspraken erbij.",
        "Geef de informatie, stuur de kopie of pas de gegevens aan.",
        "Klopt het bedrag niet volgens de klant? Zie 'Klant vindt het factuurbedrag niet kloppen'."
      ],
      "naarJarno": "Het bedrag moet aangepast worden.",
      "magZelf": [
        "Informatie geven, kopieën sturen en gegevens aanpassen."
      ],
      "vastleggen": "Gewijzigde gegevens.",
      "afgerond": "De klant heeft zijn antwoord.",
      "klantbericht": "Hoi [naam], dank voor je vraag! [Antwoord]. Laat het gerust weten als er nog iets is.",
      "zoekwoorden": "factuur, factuurvraag, wanneer factuur, kopie factuur, factuuradres, adres, po nummer, btw, factuurregel, uitleg factuur"
    },
    {
      "id": "factuur-betwist",
      "titel": "Klant vindt het factuurbedrag niet kloppen",
      "categorie": "factuur",
      "niveau": "r",
      "eigenaar": "bi",
      "waarom": "Een bedrag aanpassen of crediteren is een financiële beslissing.",
      "situatie": "De klant vindt het bedrag te hoog of vraagt een creditfactuur.",
      "stappen": [
        "Stuur de klant het wachtbericht.",
        "Vraag welk deel en waarom.",
        "Zoek afspraken en geleverde video's erbij.",
        "Leg het voor aan Jarno."
      ],
      "naarJarno": "Altijd: kom met een voorstel en leg het voor aan Jarno.",
      "magZelf": [
        "Uitleggen wat er geleverd is."
      ],
      "vastleggen": "Bezwaar en feiten.",
      "afgerond": "Jarno heeft besloten.",
      "klantbericht": "Hoi [naam], dank voor je bericht. Ik zoek het voor je uit en kom er uiterlijk [dag] bij je op terug.",
      "zoekwoorden": "bedrag te hoog, factuur klopt niet, betwist, te veel, creditfactuur, creditnota, crediteren",
      "voorbereiding": "cc"
    },
    {
      "id": "betaalafspraak",
      "titel": "Klant wil later of anders betalen",
      "categorie": "factuur",
      "niveau": "r",
      "eigenaar": "bi",
      "waarom": "Betaaltermijnen raken de cashflow.",
      "situatie": "Uitstel, in delen betalen, tijdelijk minder betalen of facturatie pauzeren.",
      "stappen": [
        "Stuur de klant het wachtbericht.",
        "Vraag wat hij precies wil en waarom.",
        "Doe geen toezeggingen.",
        "Leg het voor aan Jarno."
      ],
      "naarJarno": "Altijd: kom met een voorstel en leg het voor aan Jarno.",
      "magZelf": [
        "Navragen."
      ],
      "vastleggen": "Verzoek.",
      "afgerond": "Jarno heeft besloten.",
      "klantbericht": "Hoi [naam], dank voor je bericht. Ik bespreek het intern en kom er uiterlijk [dag] bij je op terug.",
      "zoekwoorden": "later betalen, uitstel, splitsen, termijnen, betalingsregeling, minder betalen, facturatie pauzeren",
      "voorbereiding": "cc"
    },
    {
      "id": "niet-betaald",
      "titel": "Klant heeft nog niet betaald",
      "categorie": "factuur",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Herinneren doe je zelf. Vervolgstappen beslist Jarno.",
      "situatie": "Een factuur staat open na de vervaldatum.",
      "stappen": [
        "Herinnering de dag na de vervaldatum.",
        "Na [[7 dagen]]: tweede herinnering.",
        "Na [[14 dagen]]: bellen.",
        "Leg elke stap vast bij de factuur."
      ],
      "naarJarno": "Na [[21 dagen]] nog niet betaald.",
      "magZelf": [
        "Herinneren en bellen tot [[21 dagen]]."
      ],
      "vastleggen": "Herinneringen bij de factuur.",
      "afgerond": "De factuur is betaald.",
      "klantbericht": "Hoi [naam], volgens onze administratie staat factuur [nummer] nog open. Zou je hem willen betalen? Is hij al betaald, dan kun je dit bericht als niet verzonden beschouwen. Dank je!",
      "zoekwoorden": "niet betaald, openstaand, achterstand, herinnering, betaling, wanbetaler",
      "keuzehulp": {
        "vraag": "Hoe lang staat de factuur open na de vervaldatum?",
        "opties": [
          {
            "antwoord": "Korter dan [[14 dagen]]",
            "uitkomst": {
              "niveau": "g",
              "tekst": "Stuur de standaard herinneringen."
            }
          },
          {
            "antwoord": "[[14 tot 21 dagen]]",
            "uitkomst": {
              "niveau": "o",
              "tekst": "Bel de klant en vraag een concrete betaaldatum. Leg die vast."
            }
          },
          {
            "antwoord": "Langer dan [[21 dagen]]",
            "uitkomst": {
              "niveau": "r",
              "tekst": "Jarno beslist over vervolgstappen zoals productie pauzeren of incasso."
            }
          }
        ]
      }
    },
    {
      "id": "korting",
      "titel": "Klant vraagt korting of vindt het te duur",
      "categorie": "factuur",
      "niveau": "r",
      "eigenaar": "bi",
      "waarom": "Elke prijsafspraak raakt de marge.",
      "situatie": "De klant vraagt een lagere prijs.",
      "stappen": [
        "Stuur de klant het wachtbericht.",
        "Vraag waarom.",
        "Bedenk een alternatief zonder korting, zoals minder video's of langere looptijd.",
        "Leg het voor aan Jarno."
      ],
      "naarJarno": "Altijd: kom met een voorstel en leg het voor aan Jarno.",
      "magZelf": [
        "Navragen en voorbereiden."
      ],
      "vastleggen": "Verzoek.",
      "afgerond": "Jarno heeft besloten.",
      "klantbericht": "Hoi [naam], dank voor je vraag. Ik bespreek het intern en kom er uiterlijk [dag] bij je op terug.",
      "zoekwoorden": "korting, goedkoper, prijs omlaag, te duur, aanbieding, deal, prijs",
      "voorbereiding": "cc"
    },
    {
      "id": "compensatie",
      "titel": "Klant wil compensatie, iets gratis of geld terug",
      "categorie": "factuur",
      "niveau": "r",
      "eigenaar": "bi",
      "waarom": "Geld of gratis werk raakt de marge.",
      "situatie": "Een gratis video, gratis maand, compensatie voor vertraging of geld terug.",
      "stappen": [
        "Stuur de klant het wachtbericht.",
        "Zet de feiten op een rij.",
        "Bedenk een oplossing zonder geld, bijvoorbeeld een extra revisieronde.",
        "Leg het voor aan Jarno."
      ],
      "naarJarno": "Altijd: kom met een voorstel en leg het voor aan Jarno.",
      "magZelf": [
        "Oplossingen binnen je bevoegdheid voorstellen."
      ],
      "vastleggen": "Verzoek en feiten.",
      "afgerond": "Jarno heeft besloten en de klant is geïnformeerd.",
      "klantbericht": "Hoi [naam], ik begrijp je vraag. Ik bespreek het intern en kom er uiterlijk [dag] bij je op terug.",
      "zoekwoorden": "compensatie, gratis, gratis video, geld terug, terugbetaling, vergoeding, coulance, restitutie",
      "voorbereiding": "cc"
    },
    {
      "id": "contractvraag",
      "titel": "Klant vraagt naar looptijd of opzegtermijn",
      "categorie": "contract",
      "niveau": "g",
      "eigenaar": "cc",
      "waarom": "Informatie geven. Let wel op: het kan een stopsignaal zijn.",
      "situatie": "De klant wil weten wanneer het contract afloopt of hoe opzeggen werkt.",
      "stappen": [
        "Check de looptijd en opzegtermijn in de Hub.",
        "Geef de informatie.",
        "Vraag of er iets speelt. Zo ja: zie 'Klant dreigt te stoppen'."
      ],
      "naarJarno": "Er blijkt een wens om te stoppen.",
      "magZelf": [
        "Informatie geven."
      ],
      "vastleggen": "Signaal in het klantdossier.",
      "afgerond": "De klant weet het.",
      "klantbericht": "Hoi [naam], je contract loopt tot [datum] met een opzegtermijn van [termijn]. Speelt er iets waar ik je mee kan helpen? Dan hoor ik het graag.",
      "zoekwoorden": "contract afloopt, einddatum, looptijd, opzegtermijn, opzeggen, hoe stoppen"
    },
    {
      "id": "stoppen",
      "titel": "Klant wil stoppen",
      "categorie": "contract",
      "niveau": "r",
      "eigenaar": "bi",
      "waarom": "Beëindiging raakt omzet en contract.",
      "situatie": "De klant wil de samenwerking beëindigen.",
      "stappen": [
        "Stuur de klant het wachtbericht.",
        "Vraag naar de echte reden.",
        "Verzamel looptijd, opzegtermijn, open facturen en resultaten.",
        "Leg het binnen [[1 werkdag]] voor aan Jarno."
      ],
      "naarJarno": "Altijd: kom met een voorstel en leg het voor aan Jarno.",
      "magZelf": [
        "Luisteren en informatie verzamelen.",
        "Lopende productie normaal afronden."
      ],
      "vastleggen": "Reden en contractgegevens.",
      "afgerond": "Jarno heeft besloten en de klant heeft schriftelijk bericht.",
      "klantbericht": "Hoi [naam], dank dat je het laat weten. Mag ik vragen wat de reden is? Ik bespreek het intern en kom er uiterlijk [dag] bij je op terug.",
      "zoekwoorden": "stoppen, opzeggen, beëindigen, einde samenwerking, wil weg, cancel, opzegging, na drie maanden",
      "voorbereiding": "cc"
    },
    {
      "id": "verlengen",
      "titel": "Klant wil verlengen",
      "categorie": "contract",
      "niveau": "r",
      "eigenaar": "bi",
      "waarom": "Verlenging legt prijs en looptijd vast.",
      "situatie": "De klant wil door na de huidige looptijd.",
      "stappen": [
        "Bedank de klant.",
        "Vraag of hij iets wil wijzigen.",
        "Maak een voorstel.",
        "Leg het voor aan Jarno."
      ],
      "naarJarno": "Altijd: kom met een voorstel en leg het voor aan Jarno.",
      "magZelf": [
        "Voorbereiden."
      ],
      "vastleggen": "Voorstel.",
      "afgerond": "De verlenging is getekend en de nieuwe looptijd staat in de Hub.",
      "klantbericht": "Hoi [naam], wat fijn om te horen, dank je wel! Ik zet een voorstel voor je klaar en stuur het je uiterlijk [dag].",
      "zoekwoorden": "verlengen, verlenging, doorgaan, nieuw contract, nog een periode",
      "voorbereiding": "cc"
    },
    {
      "id": "andere-afspraken",
      "titel": "Klant wil andere voorwaarden of een extra dienst",
      "categorie": "contract",
      "niveau": "r",
      "eigenaar": "bi",
      "waarom": "Nieuwe afspraken betekenen een nieuwe prijs of nieuwe voorwaarden.",
      "situatie": "Afwijkende voorwaarden, content voor een tweede bedrijf, advertenties of andere kanalen.",
      "stappen": [
        "Vraag wat de klant precies wil bereiken.",
        "Maak een eerste voorstel [[volgens de prijslijst]].",
        "Leg het voor aan Jarno."
      ],
      "naarJarno": "Altijd: kom met een voorstel en leg het voor aan Jarno.",
      "magZelf": [
        "Voorbereiden."
      ],
      "vastleggen": "Verzoek en voorstel.",
      "afgerond": "Er ligt een akkoord en het staat in de Hub.",
      "klantbericht": "Hoi [naam], leuk dat je dit aangeeft! Ik werk een voorstel voor je uit en kom er uiterlijk [dag] bij je op terug.",
      "zoekwoorden": "voorwaarden, tweede bedrijf, ander bedrijf, extra dienst, advertenties, ads, meer kanalen, live, uitbreiding",
      "voorbereiding": "cc"
    },
    {
      "id": "videograaf-uitval",
      "titel": "Videograaf of freelancer valt uit",
      "categorie": "ziekte",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Vervangen binnen de begroting regel je zelf.",
      "situatie": "De videograaf of een freelancer kan niet.",
      "stappen": [
        "Zoek binnen [[2 uur]] vervanging.",
        "Brief de vervanger met opnamekaart en scripts.",
        "Geen vervanging? Bel de klant en verplaats.",
        "Werk de agenda bij."
      ],
      "naarJarno": "Vervanging kost meer dan [[€250]] buiten de begroting.",
      "magZelf": [
        "Een vervanger inzetten binnen de begroting.",
        "De opname verplaatsen."
      ],
      "vastleggen": "Wie er is ingezet of de nieuwe datum.",
      "afgerond": "De opname is uitgevoerd of opnieuw gepland.",
      "klantbericht": "Hoi [naam], onze videograaf is helaas ziek. [Vervanger] komt in zijn plaats, de opname gaat gewoon door. / We willen de opname graag verplaatsen naar [datum]. Past dat?",
      "zoekwoorden": "videograaf ziek, cameraman ziek, freelancer, uitval, kan niet, afgehaakt"
    },
    {
      "id": "editor-uitval",
      "titel": "Editor valt uit",
      "categorie": "ziekte",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Werk verdelen regel je zelf.",
      "situatie": "Een editor is ziek of niet beschikbaar.",
      "stappen": [
        "Zet openstaand werk bij een andere editor.",
        "Prioriteer op deadline.",
        "Informeer klanten als het schuift."
      ],
      "naarJarno": "Er is extra budget nodig.",
      "magZelf": [
        "Werk herverdelen binnen de begroting."
      ],
      "vastleggen": "Nieuwe verdeling.",
      "afgerond": "Al het werk heeft een editor.",
      "klantbericht": null,
      "zoekwoorden": "editor ziek, uitval editor, editor weg"
    },
    {
      "id": "collega-uitval",
      "titel": "Collega valt uit",
      "categorie": "ziekte",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Samen opvangen. Langdurig is voor Jarno.",
      "situatie": "Je collega Content Creative is ziek, of meerdere mensen vallen tegelijk uit.",
      "stappen": [
        "Check de urgente zaken van vandaag en morgen.",
        "Neem alleen het urgente over.",
        "Zet freelancers in binnen de begroting als dat nodig is.",
        "Informeer klanten als iets schuift."
      ],
      "naarJarno": "De uitval duurt langer dan [[1 week]] of kost extra budget.",
      "magZelf": [
        "Urgent werk overnemen, prioriteren en deadlines verschuiven."
      ],
      "vastleggen": "Wat er is overgenomen.",
      "afgerond": "Alle urgente zaken lopen.",
      "klantbericht": null,
      "zoekwoorden": "collega ziek, content creative ziek, uitval, twee ziek, onderbezetting, tekort"
    },
    {
      "id": "klant-ziek",
      "titel": "Klant is ziek op de opnamedag",
      "categorie": "ziekte",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Verplaatsen regel je zelf.",
      "situatie": "De klant of presentator is ziek.",
      "stappen": [
        "Check of iemand anders kan presenteren.",
        "Zo niet: verplaats de opname.",
        "Informeer de videograaf."
      ],
      "naarJarno": "Niet nodig.",
      "magZelf": [
        "Verplaatsen zonder kosten."
      ],
      "vastleggen": "Nieuwe datum.",
      "afgerond": "De opname staat opnieuw.",
      "klantbericht": "Hoi [naam], vervelend, beterschap! Laten we de opname verplaatsen. Past [datum 1] of [datum 2]?",
      "zoekwoorden": "klant ziek, presentator ziek, beterschap"
    },
    {
      "id": "vrij-ruilen",
      "titel": "Collega wil vrij of een dienst ruilen",
      "categorie": "ziekte",
      "niveau": "o",
      "eigenaar": "bi",
      "waarom": "Ruilen mag onderling. Verlof goedkeuren doet Jarno.",
      "situatie": "Een collega wil kort van tevoren vrij of een opnamedag ruilen.",
      "stappen": [
        "Ruilen: regel het onderling en pas de agenda aan.",
        "Vrij: check welk werk blijft liggen.",
        "Stel voor wie wat opvangt.",
        "Leg het vrij-verzoek voor aan [[Jarno]]."
      ],
      "naarJarno": "Elk verlofverzoek.",
      "magZelf": [
        "Diensten onderling ruilen.",
        "Een opvangplan maken."
      ],
      "vastleggen": "Agenda en opvangplan.",
      "afgerond": "Er is besloten en het werk is opgevangen.",
      "klantbericht": null,
      "zoekwoorden": "vrij, verlof, vrije dag, last minute vrij, ruilen, dienst ruilen, wisselen"
    },
    {
      "id": "te-veel-werk",
      "titel": "Ik heb te veel werk",
      "categorie": "team",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Eerst zelf prioriteren, dan aangeven.",
      "situatie": "Je werkdruk is te hoog of je haalt een deadline niet.",
      "stappen": [
        "Zet alles op een rij met deadlines.",
        "Schrap of schuif wat kan.",
        "Vraag je collega om hulp.",
        "Blijft het te veel? Meld het met een voorstel."
      ],
      "naarJarno": "Het blijft [[2 weken]] te veel.",
      "magZelf": [
        "Prioriteren, verschuiven en hulp vragen."
      ],
      "vastleggen": "Signaal.",
      "afgerond": "De werkdruk is werkbaar.",
      "klantbericht": null,
      "zoekwoorden": "te veel werk, te druk, werkdruk, overbelast, deadline niet halen, redt het niet"
    },
    {
      "id": "wie-eigenaar",
      "titel": "Ik weet niet wie verantwoordelijk is",
      "categorie": "team",
      "niveau": "g",
      "eigenaar": "cc",
      "waarom": "De hoofdregel: de Content Creative van de klant is eigenaar.",
      "situatie": "Onduidelijk wie iets moet oppakken.",
      "stappen": [
        "Gaat het om een klant? Dan de Content Creative van die klant.",
        "Gaat het om de opnamedag? Dan de videograaf op locatie.",
        "Nog onduidelijk? Pak het zelf op en meld het."
      ],
      "naarJarno": "Niet nodig.",
      "magZelf": [
        "Zelf oppakken."
      ],
      "vastleggen": "Eigenaar in de Hub.",
      "afgerond": "Iemand is eigenaar.",
      "klantbericht": null,
      "zoekwoorden": "wie verantwoordelijk, eigenaar, wie doet dit, wie moet dit"
    },
    {
      "id": "collega-afspraken",
      "titel": "Collega komt afspraken niet na of zegt iets anders",
      "categorie": "team",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Eerst zelf aanspreken.",
      "situatie": "Een collega houdt zich niet aan afspraken, of je krijgt tegenstrijdige instructies.",
      "stappen": [
        "Spreek je collega direct en rustig aan.",
        "Bij tegenstrijdige instructies: kies wat het beste is voor de klant en meld je keuze.",
        "Maak een concrete afspraak.",
        "Blijft het gebeuren? Meld het."
      ],
      "naarJarno": "Het blijft gebeuren, of het raakt geld of contract.",
      "magZelf": [
        "Aanspreken en een keuze maken."
      ],
      "vastleggen": "Afspraak.",
      "afgerond": "Het is duidelijk.",
      "klantbericht": null,
      "zoekwoorden": "collega, afspraken, niet nagekomen, tegenstrijdig, instructies, samenwerking"
    },
    {
      "id": "editor-kwaliteit",
      "titel": "Editor levert vaak slechte kwaliteit",
      "categorie": "team",
      "niveau": "o",
      "eigenaar": "cc",
      "waarom": "Feedback geven en werk verschuiven kun je zelf.",
      "situatie": "Een editor haalt vaak de standaard niet.",
      "stappen": [
        "Verzamel drie voorbeelden met feedback.",
        "Bespreek het met de editor.",
        "Geef minder of eenvoudiger werk tot het beter gaat.",
        "Geen verbetering? Meld het."
      ],
      "naarJarno": "Stoppen met de editor.",
      "magZelf": [
        "Feedback geven en werk verdelen."
      ],
      "vastleggen": "Feedback per editor.",
      "afgerond": "De kwaliteit is op niveau.",
      "klantbericht": null,
      "zoekwoorden": "editor slecht, kwaliteit editor, structureel, editor niet goed"
    },
    {
      "id": "fout-met-kosten",
      "titel": "Er is een fout gemaakt die geld kost",
      "categorie": "team",
      "niveau": "r",
      "eigenaar": "bi",
      "waarom": "Financiële schade is altijd voor Jarno.",
      "situatie": "Er is een fout gemaakt met financiële gevolgen.",
      "stappen": [
        "Beperk de schade direct.",
        "Zet de feiten op een rij.",
        "Leg het eerlijk voor aan Jarno met een voorstel."
      ],
      "naarJarno": "Altijd: kom met een voorstel en leg het voor aan Jarno.",
      "magZelf": [
        "Schade beperken."
      ],
      "vastleggen": "Feiten.",
      "afgerond": "Jarno heeft besloten.",
      "klantbericht": null,
      "zoekwoorden": "fout, financiële gevolgen, kost geld, schade, vergissing",
      "voorbereiding": "cc"
    },
    {
      "id": "freelancer-tarief",
      "titel": "Freelancer vraagt een hogere vergoeding",
      "categorie": "team",
      "niveau": "r",
      "eigenaar": "bi",
      "waarom": "Tarieven zijn een financiële beslissing.",
      "situatie": "Een freelancer wil meer betaald krijgen.",
      "stappen": [
        "Vraag waarom.",
        "Doe geen toezeggingen.",
        "Leg het voor aan Jarno."
      ],
      "naarJarno": "Altijd: kom met een voorstel en leg het voor aan Jarno.",
      "magZelf": [
        "Navragen."
      ],
      "vastleggen": "Verzoek.",
      "afgerond": "Jarno heeft besloten.",
      "klantbericht": null,
      "zoekwoorden": "freelancer, tarief, vergoeding, meer betaald, uurtarief",
      "voorbereiding": "cc"
    },
    {
      "id": "procesidee",
      "titel": "Ik heb een idee om iets te verbeteren",
      "categorie": "team",
      "niveau": "g",
      "eigenaar": "cc",
      "waarom": "Verbeteren wordt aangemoedigd.",
      "situatie": "Je ziet hoe iets beter kan.",
      "stappen": [
        "Schrijf het kort op: probleem, idee, effect.",
        "Kleine verbetering in je eigen werk? Gewoon doen.",
        "Raakt het het hele team? Deel het in het teamoverleg."
      ],
      "naarJarno": "Niet nodig.",
      "magZelf": [
        "Je eigen werkwijze verbeteren."
      ],
      "vastleggen": "Idee.",
      "afgerond": "Het idee is gedeeld of ingevoerd.",
      "klantbericht": null,
      "zoekwoorden": "idee, verbetering, proces, beter, voorstel"
    },
    {
      "id": "portaal-hulp",
      "titel": "Klant heeft een technisch probleem",
      "categorie": "techniek",
      "niveau": "g",
      "eigenaar": "cc",
      "waarom": "Technische hulp is gewoon werk.",
      "situatie": "Inloggen, downloaden, wachtwoord wijzigen, een account koppelen of de koppeling werkt niet.",
      "stappen": [
        "Stuur een nieuwe inloglink of downloadlink.",
        "Koppel het account opnieuw als dat nodig is.",
        "Werkt het niet? Meld het als storing en publiceer zo nodig handmatig."
      ],
      "naarJarno": "Niet nodig.",
      "magZelf": [
        "Toegang herstellen, opnieuw koppelen en handmatig posten."
      ],
      "vastleggen": "Niets extra.",
      "afgerond": "Het werkt weer.",
      "klantbericht": "Hoi [naam], vervelend! Ik heb je een nieuwe link gestuurd. Werkt het nog niet? Laat het me weten, dan lossen we het samen op.",
      "zoekwoorden": "inloggen, wachtwoord, portaal, downloaden, download, account koppelen, koppeling, metricool, nieuw account, technisch"
    },
    {
      "id": "datalek",
      "titel": "Mogelijk datalek of juridisch probleem",
      "categorie": "techniek",
      "niveau": "r",
      "eigenaar": "bi",
      "waarom": "Juridisch risico. Direct handelen.",
      "situatie": "Gegevens of beelden zijn bij de verkeerde persoon, beeld zonder toestemming, of een juridische dreiging.",
      "stappen": [
        "Beperk direct de schade: link intrekken, post offline, bestanden afschermen.",
        "Bel Jarno direct, niet via een bericht.",
        "Leg feiten en tijdstippen vast.",
        "Communiceer niets naar buiten zonder akkoord."
      ],
      "naarJarno": "Direct, altijd.",
      "magZelf": [
        "Direct ingrijpen."
      ],
      "vastleggen": "Tijdlijn.",
      "afgerond": "Het is afgehandeld.",
      "klantbericht": null,
      "zoekwoorden": "datalek, privacy, avg, gegevens, gelekt, juridisch, toestemming, advocaat, portretrecht, aansprakelijk",
      "voorbereiding": "cc",
      "nood": true
    }
  ],
  "grenzen": [
    {
      "onderwerp": "Deadline verschuiven",
      "zelf": "Tot [[2 werkdagen]]",
      "jarno": "Meer, en de klant protesteert of wil compensatie"
    },
    {
      "onderwerp": "Script wijzigen",
      "zelf": "Altijd tot de opname, groot onderwerp binnen [[48 uur]] na check met videograaf",
      "jarno": "Als het een extra draaidag of opnametijd met kosten vraagt"
    },
    {
      "onderwerp": "Video's doorschuiven",
      "zelf": "[[Maximaal 1 maand]] binnen de looptijd",
      "jarno": "Langer, of na het einde van het contract"
    },
    {
      "onderwerp": "Opname verplaatsen",
      "zelf": "Altijd, als er nog geen kosten zijn gemaakt",
      "jarno": "Binnen [[48 uur]] met gemaakte kosten"
    },
    {
      "onderwerp": "Extra feedbackronde",
      "zelf": "[[1 per klant per kwartaal]]",
      "jarno": "Structureel meer rondes"
    },
    {
      "onderwerp": "Extra adviesgesprek",
      "zelf": "Tot [[30 minuten]]",
      "jarno": "Langere of terugkerende extra gesprekken"
    },
    {
      "onderwerp": "Extra kosten",
      "zelf": "Binnen de begroting, tot [[€250]]",
      "jarno": "Boven [[€250]] of buiten de begroting"
    },
    {
      "onderwerp": "Extra video",
      "zelf": "Omwisselen in pakket, of eenmalig tegen [[de vaste prijs]]",
      "jarno": "Structureel meer, of een afwijkende prijs"
    },
    {
      "onderwerp": "Korting",
      "zelf": "[[Niet zelf]]",
      "jarno": "Altijd"
    },
    {
      "onderwerp": "Compensatie of coulance",
      "zelf": "[[Niet zelf]]",
      "jarno": "Altijd"
    },
    {
      "onderwerp": "Betalingsachterstand",
      "zelf": "Herinneren en bellen tot [[21 dagen]]",
      "jarno": "Na [[21 dagen]] of bij productie pauzeren"
    },
    {
      "onderwerp": "Klant wil stoppen of verlengen",
      "zelf": "Luisteren en voorbereiden",
      "jarno": "Altijd"
    }
  ],
  "bevoegdheden": [
    {
      "rol": "cc",
      "zelf": [
        "Planning, deadlines en opnames verschuiven binnen de looptijd",
        "Scripts schrijven, aanpassen en de strategie bijsturen",
        "Revisies inplannen en bundelen",
        "Editors aansturen, werk herverdelen en een freelancer inzetten binnen de begroting",
        "Klantvragen over status, resultaten en strategie beantwoorden",
        "Administratieve factuurvragen en betalingsherinneringen",
        "Een klant op oranje zetten"
      ],
      "niet": [
        "Korting, compensatie of gratis video's toezeggen",
        "Contracten verlengen, wijzigen of beëindigen",
        "Prijzen afwijkend van de prijslijst afspreken",
        "Raw footage of montagebestanden afgeven [[ter bevestiging]]"
      ]
    },
    {
      "rol": "vg",
      "zelf": [
        "Volgorde, tekst en aanpak op locatie aanpassen",
        "Tot [[1 uur]] uitlopen",
        "Minder video's opnemen als de kwaliteit anders lijdt",
        "Een opname stoppen bij onveilige situaties"
      ],
      "niet": [
        "Extra draaidagen of extra video's toezeggen aan de klant",
        "Afspraken maken over kosten of uitloop"
      ]
    },
    {
      "rol": "bi",
      "zelf": [
        "Contracten: verlengen, wijzigen, beëindigen",
        "Prijzen, kortingen en compensatie",
        "Facturen die betwist worden en betaalregelingen",
        "Kosten boven [[€250]] buiten de begroting",
        "Juridische, privacy- en reputatiekwesties",
        "Ernstige klachten en klanten die dreigen te stoppen"
      ],
      "niet": []
    }
  ],
  "top": {
    "cc": [
      "extra-script",
      "script-eruit",
      "script-lastminute",
      "scripts-geen-reactie",
      "kleine-wijziging",
      "extra-feedbackronde",
      "opname-verplaatsen",
      "extra-video"
    ],
    "vg": [
      "klant-niet-klaar",
      "opname-loopt-uit",
      "script-onuitvoerbaar",
      "klant-afwezig",
      "locatie-probleem",
      "apparatuur-uitval",
      "materiaal-mist",
      "videograaf-uitval"
    ],
    "bi": [
      "stoppen",
      "dreigt-stoppen",
      "korting",
      "compensatie",
      "pakket-wijzigen",
      "factuur-betwist",
      "betaalafspraak",
      "datalek"
    ]
  },
  "openPunten": [
    "Bevestig alle gele voorstellen hieronder (termijnen en bedragen). In de teamweergave staan ze er al als vaste regel.",
    "Korting en compensatie: nu altijd naar Jarno. In het eerdere beslissysteem mocht een Content Creative zelf tot 5% korting en €250 coulance geven. Kies één lijn.",
    "Jouw reactietermijn op escalaties staat op 1 werkdag. Het team belooft klanten daarom een antwoord binnen 2 werkdagen.",
    "Verlof keurt Jarno goed. Moet dat Christian zijn, of jullie allebei?",
    "Oranje betekent: zelf oplossen en vastleggen in de Hub, zonder aparte melding. Dat is een vereenvoudiging van het eerdere 'zelf doen en achteraf melden'."
  ]
};
