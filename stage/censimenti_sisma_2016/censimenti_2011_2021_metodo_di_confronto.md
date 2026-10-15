# Come la mappa "Popolazione 2011 – 2021" confronta due censimenti

Analisi del metodo di comparazione implementato in
`index_embed_italia_censimenti_compare_procom.html` + `layer_compare.js`
(`~/Repositories/GitHub/stage/stories/`).

Documento verificato sui dati reali: ogni numero citato è stato ricalcolato scaricando le stesse
sorgenti che usa la mappa (vedi § 9 per l'elenco).

---

## 1. Il problema

Confrontare il censimento 2011 con il 2021 in Italia significa affrontare tre disallineamenti
simultanei:

| Disallineamento | Entità (misurata) |
|---|---|
| **Codici comunali cambiati** (fusioni, nuove province, passaggi di regione) | 8.092 comuni nel 2011 → 7.904 nel 2021; **464 codici 2011** (1.251.560 ab.) e **276 codici 2021** (1.221.749 ab.) non hanno omonimo nell'altra annata |
| **Sezioni di censimento ridisegnate** | in Trentino‑Alto Adige 9.979 sezioni 2011 → 23.780 nel 2021 (2,4×); in Valle d'Aosta 1.479 → 2.458 |
| **Schemi di variabili diversi** | il tracciato 2011 (`P1…P140`, `ST1…`, `A…`, `E…`, `PE…`) e quello 2021 (`P1…P103`, `IT…`, `ST…`) coincidono solo in parte |

La mappa non "risolve" questi problemi in modo definitivo: li affronta con una strategia a **due
livelli territoriali** e con **aggregazione spaziale dipendente dalla scala**, che è la vera chiave
del metodo.

---

## 2. Architettura: due confronti, non uno

La mappa contiene **due temi di confronto sovrapposti**, mutuamente esclusivi per scala:

| | Tema comunale | Tema per sezioni |
|---|---|---|
| nome interno | `chart_procom_all` | `chart` |
| geometria | comuni ISTAT 2022 (`Com01012022_s_WGS84.topojson.gz`) + centroidi *urban fabric* 2011 (dataset di Andrea Borruso) | basi territoriali 2011 **e** 2021 (`R{NN}_11_P` / `R{NN}_21_P`) |
| dati | `all_indicatori_{2011,2021}_procom.csv.gz` (nazionale) | `R{NN}_indicatori_{2011,2021}_sezioni.csv.gz` (per regione) |
| visibilità | `chartlower: "1:150000"` → visibile **solo da 1:150.000 in su** (zoom out) | `chartupper: "1:150000"` → visibile **solo sotto 1:150.000** (zoom in) |
| chiave di join | `PROCOM` (codice comune) | `SEZ2011` / `SEZ21_ID` (codice sezione) |
| allineamento codici | **sì** (AP + fusioni) | **solo AP** |

Il passaggio di consegne a 1:150.000 è la scelta progettuale centrale: il confronto per sezioni,
che è geometricamente fragile, viene mostrato solo quando si è abbastanza dentro da poterlo leggere
come *pattern locale*; il confronto comunale, robusto, copre tutte le scale superiori.
Anche i poligoni delle sezioni hanno `featureupper: "1:150000"`, e il caricamento delle basi
territoriali è **per regione**, ricalcolato al volo quando il centro mappa cambia regione
(`ixmaps.htmlgui_onZoomAndPan` → `__checkNewRegion` → `map().replace("sezioni_2011"/"sezioni_2021", …)`).

---

## 3. Struttura dei codici (perché il join per ID è possibile)

Nei file ISTAT degli indicatori la chiave di sezione è la concatenazione
`PROCOM` + numero di sezione a 7 cifre, in entrambe le annate:

```
2011:  SEZ2011  = 7001 + 0000001 = 70010000001     (file separato da ';')
2021:  SEZ21_ID = 7001 + 0000001 = 70010000001     (file separato da ',')
```

Il codice sfrutta esattamente questa regola per ricavare il comune da una sezione
(`layer_compare.js:135`):

```js
let procom = value.substr(0, value.length - 7);
```

Le sezioni "speciali" `…8888888` (popolazione non localizzabile in una sezione) vengono eliminate
in entrata (`select("WHERE SEZ2011 NOT 888888")`). Sono trascurabili: 0,02–0,06 % della popolazione
regionale nei campioni verificati (VdA e TAA, entrambe le annate).

---

## 4. La pipeline di confronto

### 4.1 Livello comunale — `query_data_procom_all()` (`layer_compare.js:222`)

```
ixmaps.__getSituasComuneTranslation()        (snapshot statico SITUAS, in parallelo al Data.Broker)
Data.Broker
 ├── all_indicatori_2011_procom.csv.gz      (8.092 righe, 59.433.744 ab.)
 └── all_indicatori_2021_procom.csv.gz      (7.904 righe, 59.030.133 ab.)
      │
      ├─ (1) rimappa i codici 2011 con la traduzione SITUAS (report 99)
      ├─ (2) condense(lead: "PROCOM")   → somma le righe 2011 confluite nello stesso comune 2021
      ├─ (3) Data.Merger su PROCOM      → colonne suffissate .1 (2011) e .2 (2021)
      └─ (4) colonna derivata ST1.12
```

**(1) Traduzione SITUAS (report 99)** — `ixmaps.__getSituasComuneTranslation()` (`layer_compare.js:78`)
legge `ixmaps.__getSituasCodes()` (`layer_compare.js:54`), che scarica una **sola volta per sessione**
lo snapshot statico `situas_codes.json` da CDN (jsDelivr, repo `ixmaps-data`) e lo mette in cache. Lo
snapshot è generato da `ixmaps-data/scripts/fetch_situas_censimenti_2011_2021.py`, che interroga il
registro ISTAT SITUAS (individuato tramite lo strumento `ondata/opensituas`) e lo ripubblica
pre‑elaborato. Il report 99 è una tabella di traduzione **già risolta** dall'ISTAT stesso — un solo
lookup sostituisce sia il passaggio `AP` sia il passaggio `CS`/fusione, **e in più risolve
correttamente le 14 incorporazioni** (tipo `ES`, § 7.1):

```js
data_2011.column("PROCOM").map(function (value) {
    return newPROCOM[value] || value;
});
```

Un **singolo lookup**, non un ciclo che segue le catene: il report 99 dà già, in un'unica riga, il
codice finale risolto per l'intero periodo richiesto. Seguire le catene non è necessario, e sarebbe
anzi sbagliato: il report elenca anche gli oltre 7.600 comuni mai cambiati come auto‑mappature
(`"1001" → "1001"`), su cui un ciclo che insegue il valore successivo non terminerebbe mai. I codici
SITUAS sono stringhe a 6 cifre con zero iniziali (`"002114"`); il CSV dei censimenti usa invece
codici senza zero iniziali (`"2114"`) — lo script di generazione normalizza entrambi i lati con la
stessa convenzione `String(Number(...))`/`str(int(...))` già in uso nel resto del file, così lo
snapshot arriva già pronto per il lookup diretto.

Il periodo di traduzione (`31/12/2011 → 31/12/2021`, fissato nello script di generazione) **deve**
coincidere con l'annata dei dati 2021: un periodo più ampio (es. fino a oggi) rimapperebbe i codici
2011 oltre il punto in cui si trova il lato 2021 del confronto, disallineandoli di nuovo — per
esempio il riordino sardo 2026 (§ 4.2) non va applicato qui, perché i dati 2021 non lo riflettono.

Comuni nati da *porzioni* di territorio (**Mappano**, `001316`, 2017; **Misiliscemi**, `081025`,
2021) **non hanno un codice sorgente 2011** per costruzione: SITUAS li lascia correttamente senza
predecessore invece di inventarne uno.

**(2) `condense`** somma le righe 2011 che, dopo la rimappatura, puntano allo stesso comune 2021:
è il passaggio che realizza materialmente l'**aggregazione dei comuni fusi** (5 comuni della
Valsamoggia → 1 riga 2011 confrontabile con la riga 2021 di Valsamoggia).

**(3) `Data.Merger`** produce le colonne `P1.1` (2011) e `P1.2` (2021), `ST1.1`/`ST1.2`, ecc.
La coppia di suffissi è ciò che i temi leggono come `value: "P1.1|P1.2"`.

**(4) `ST1.12`** (`layer_compare.js:275`) è la % di stranieri 2011 riproiettata sulla
popolazione 2021: `floor(ST1.1 × P1.2 / P1.1)`. Nessun tema attuale la usa — la tecnica `value100`
in coppia descritta al § 5 è corretta anche sotto aggregazione.

### 4.2 Livello sezione — `query_data()` (`layer_compare.js:99`)

Differisce in tre punti importanti:

1. applica **solo** la rimappatura `AP`, e la applica **al prefisso dell'ID di sezione**:
   `70010000001` → sostituzione del solo `PROCOM` iniziale. Le fusioni **non** vengono rimappate
   (il § 7.3 mostra che è la scelta giusta). La fonte è `ixmaps.__getSituasApOnlyTranslation()`
   (`layer_compare.js:89`), che legge lo stesso snapshot statico `situas_codes.json` di § 4.1
   (sotto la chiave `ap_only_translation`, popolata dallo script di generazione dal report SITUAS
   **129** — "Variazioni amministrative e territoriali dei comuni dal 1991", tutta la storia dal
   1991 a oggi in un'unica chiamata — filtrando su `DESC_COD_VARIAZIONE.startswith("AP")` **e** data
   evento (`DATA_INIZIO_AMMINISTRATIVA`) `≤ 31/12/2021`, lo stesso limite superiore usato per il
   report 99, per non disallineare i due lati del confronto). Report 99 non è utilizzabile qui: è
   già una traduzione "appiattita" che mescola `AP`+`CS`+`ES`, e non può essere filtrata per tipo —
   userlo rimapperebbe anche le fusioni, sbagliato a livello di sezione (§ 7.3). Gli eventi `AP`
   entro il 31/12/2021 sono **314** successivi al 2011 (progressione: 1 nel 2017 — Sappada, BL→UD;
   1 nel 2018 — Torre de' Busi, LC→BG; 2 nel 2021 — Montecopiolo e Sassofeltrio, PU→RN — oltre ai 157
   del riordino sardo 2016). Un secondo riordino sardo, 155 eventi `AP` con decorrenza 01/01/2026, è
   escluso dal filtro sulla data perché posteriore all'annata 2021 dei dati;
2. **non** fa `condense`: la sezione è già l'unità minima;
3. esegue un **padding bidirezionale** che trasforma il merge in un *full outer join*
   (`layer_compare.js:142‑152`):

```js
var lookup1 = data_2011.lookupStringArray({key:"SEZ2011",  value:"P1"});
var lookup2 = data_2021.lookupStringArray({key:"SEZ21_ID", value:"P1"});
for (var i in lookup1) { if (!lookup2[i]) data_2021.addRow({"SEZ21_ID": i}); }
for (var i in lookup2) { if (!lookup1[i]) data_2011.addRow({"SEZ2011":  i}); }
```

Poiché `Data.Merger` accoppia solo chiavi presenti in entrambe le tabelle, il padding garantisce
che **l'unione** delle sezioni delle due annate sopravviva al merge: le sezioni scomparse e quelle
nuove restano nella tabella, con il lato mancante vuoto.

Effetto collaterale importante: le righe di padding hanno **solo** la colonna ID.
Il filtro `filter_compare = 'WHERE PROCOM.2 like "*"'` — che nel motore ixmaps significa
letteralmente *"il campo non è vuoto"* (`maptheme.js:9418‑9421`: `result = this.__szValue.length`) —
funziona quindi come test di esistenza nel 2021. Ne deriva un'**asimmetria**: nel tema a numeri
assoluti le sezioni **scomparse** vengono scartate, mentre le sezioni **nuove** restano e appaiono
come crescita da zero. È il punto più delicato del metodo a livello di sezione (§ 8).

---

## 5. Dove viene calcolata la differenza: nel motore, dopo l'aggregazione

Il delta non è precalcolato nei dati: è il motore SVG a calcolarlo, e **l'ordine delle operazioni
è ciò che rende il confronto matematicamente corretto anche quando i poligoni non coincidono**.

In `maptheme.js` (post‑load processing, righe ~10937‑11045) la sequenza è:

1. **aggregazione spaziale** delle righe (`AGGREGATE|SUM`): somma dei valori grezzi per unità di
   aggregazione;
2. se è definito `value100`, ogni valore viene convertito in percentuale del **proprio**
   denominatore: `v[k] × 100 / v100[k]`;
3. `DIFFERENCE`: `v[0] ← v[1] − v[0]`; con `RELATIVE`: `v[0] ← 100 / v[0]_orig × (v[1] − v[0])`
   (con guardia: se `v[0]_orig ≤ nField100Min` il risultato è 0, invece di infinito).

Ne seguono le tre formule effettivamente disegnate:

| Tema | binding | formula sull'unità di aggregazione *A* |
|---|---|---|
| variazione assoluta | `value: "P1.1\|P1.2"` | Σ<sub>A</sub>P1.2 − Σ<sub>A</sub>P1.1 |
| variazione % | `+ RELATIVE` | 100 × (Σ<sub>A</sub>P1.2 − Σ<sub>A</sub>P1.1) / Σ<sub>A</sub>P1.1 |
| variazione in punti % (stranieri, istruzione) | `value: "ST1.1\|ST1.2"`, `value100: "P1.1\|P1.2"` | 100 × Σ<sub>A</sub>ST1.2/Σ<sub>A</sub>P1.2 − 100 × Σ<sub>A</sub>ST1.1/Σ<sub>A</sub>P1.1 |

**Conseguenza cruciale**: poiché si **somma prima** e si fa il rapporto **dopo**, la variazione
percentuale di un'area aggregata è il rapporto *pooled* (corretto), non la media di rapporti; e
qualsiasi **redistribuzione di popolazione tra sezioni interne alla stessa unità di aggregazione si
annulla esattamente**. È questo, e non la rimappatura dei codici, il meccanismo che neutralizza la
riorganizzazione delle sezioni censuarie.

Rappresentazione: `userdraw: "arrowChart"` (plugin D3 `usercharts/d3/arrow_chart.js`) disegna una
freccia la cui altezza è proporzionale al valore (normalizzata su `normalsizevalue`, con `sizepow`
come esponente di percezione), verso l'alto/il basso secondo il segno, con i due colori di
`colorscheme` (`fadenegative` attenua il ramo negativo) ed etichetta numerica se lo spazio basta.

---

## 6. L'aggregazione dipendente dalla scala

`aggregationscale` è una lista di coppie `soglia di scala → unità di aggregazione`; il motore
(`maptheme.js:7943‑7962`) scorre la lista e **l'ultima soglia superata vince**, quindi più si esce
di zoom più l'aggregazione è grossolana. Valori non numerici sono nomi di campo, `…px` è una
griglia in pixel schermo.

**Tema comunale** (`aggregationscale: ["1:1","PROCOM.1", "1:10000","50px", "1:2000000","25px", "1:7000000","REGIONE.1"]`):

| Scala | Unità di aggregazione | Lettura |
|---|---|---|
| < 1:10.000 | campo `PROCOM.1` | una freccia per comune |
| 1:10.000 – 1:2.000.000 | griglia 50 px | frecce per cella (comuni contigui pooled) |
| 1:2.000.000 – 1:7.000.000 | griglia 25 px | idem, celle più fitte |
| > 1:7.000.000 | campo `REGIONE.1` | una freccia per regione |

**Tema per sezioni** (`aggregationscale: ["1:1","0", "1:10000","50px"]`): nessuna aggregazione al
massimo zoom, griglia 50 px appena si esce. `RELOCATE` riposiziona la freccia aggregata nel
baricentro geografico dei punti aggregati (non al centro della cella), così le frecce restano
ancorate al tessuto costruito.

---

## 7. I due casi difficili

### 7.1 Aggregazioni di comuni (fusioni, nuove province) — quanto funziona

Confrontando le due tabelle censuarie con ciascuna strategia di allineamento dei codici, ho
misurato quanti codici restano orfani (cioè quanta popolazione **non** entra nel confronto):

| Strategia di allineamento | Comuni 2011 orfani | Popolazione 2011 persa | Comuni 2021 senza controparte | Popolazione 2021 |
|---|---|---|---|---|
| nessuna rimappatura | 464 | 1.251.560 (2,11 %) | 276 | 1.221.749 |
| solo `AP` | 307 | 679.833 (1,14 %) | 119 | 669.208 |
| `AP` + `CS`/fusione | 30 | 22.820 (0,04 %) | 7 | 26.907 |
| `AP` + `CS`/fusione + `ES` | 16 | 14.021 (0,02 %) | 7 | 26.907 |
| **SITUAS report 99 (usato dalla mappa)** | **0** | **0 (0,00 %)** | **2** | **15.784** |

Con la traduzione SITUAS il confronto comunale è **completo sul lato 2011**: ogni comune del 2011
trova una controparte 2021. Rimane un solo tipo di residuo, sul lato 2021, ed è strutturale — non
un limite del metodo di rimappatura (vedi sotto): report 99 risolve `AP` + `CS` + `ES` in un solo
lookup già fornito dall'ISTAT, ed è sempre aggiornato alla data richiesta (§ 4.1).

**L'unico residuo, spiegato:**

**Comuni nati da porzioni di territorio**, per i quali un aggancio 1:1 non esiste per costruzione:
Misiliscemi (`081025`, 8.415 ab., 2021, da Trapani) e Mappano (`001316`, 7.369 ab., 2017).
Appaiono come crescita da zero; i comuni donatori come calo. Un confronto corretto richiederebbe
una riproporzionalizzazione areale, non una tabella di codici: non esiste un comune "predecessore"
a cui attribuire la popolazione 2011.

**Non gestite da SITUAS**: le variazioni di tipo `AQ` (acquisizione di territorio, 197 comuni
coinvolti su tutta la serie storica, § 9) e `CE` (cessione/permuta, 197 comuni). Sono comuni che
*restano* con lo stesso codice ma con un perimetro diverso: il confronto li tratta come invariati.
Il report SITUAS 129 (§ 4.2) *elenca* con data precisa quali comuni sono coinvolti da `AQ`/`CE` —
utile per segnalarli — ma non fornisce (né potrebbe, essendo un cambio di perimetro e non di
codice) un modo per correggere numericamente la popolazione spostata. L'errore resta locale e
generalmente piccolo, ma silenzioso.

### 7.2 Riorganizzazione delle sezioni 2011 → 2021 — quanto sono confrontabili gli ID

Misure su due regioni intere (dati e geometrie ufficiali, esclusi i codici `…8888888`):

| | Valle d'Aosta | Trentino‑Alto Adige |
|---|---|---|
| sezioni 2011 / 2021 | 1.479 / 2.458 | 9.979 / 23.780 |
| ID identici nelle due annate | 1.390 (94,0 % del 2011; 56,6 % del 2021) | 8.964 (89,8 % del 2011; 37,7 % del 2021) |
| pop. 2011 in sezioni con ID condiviso | 99,2 % | 92,8 % |
| pop. 2021 in sezioni con ID condiviso | 91,7 % | 87,9 % |
| pop. media, sezioni con ID condiviso | 81 ab. | 105 ab. |
| pop. media, sezioni 2021 *nuove* | 9,6 ab. | 8,8 ab. |

Letture:

* **L'ID è stabile per la grande maggioranza della popolazione.** Il 2021 ha molte più sezioni, ma
  quelle nuove sono in media dieci volte più piccole: sono soprattutto sottodivisioni e sezioni
  poco o non abitate.
* **E l'ID identifica davvero lo stesso posto.** Confrontando i centroidi delle sezioni con ID
  uguale (geometrie topojson 2011 vs 2021): distanza mediana **8 m**, p90 85 m in TAA;
  il 91 % si sposta di meno di un quarto del lato equivalente della sezione. Non è coincidenza di
  numerazione: è continuità reale.
* **Ma la geometria cambia comunque, spesso.** Sul rapporto tra area 2021 e area 2011 a ID uguale
  (Valle d'Aosta): mediana 1,000, però solo il **44,8 %** delle sezioni resta entro ±1 %; il 24 %
  perde oltre il 10 % di superficie, il 20 % ne guadagna oltre l'1 %.
  Cioè: quando una sezione 2011 viene divisa, una delle figlie **eredita il numero** e le altre
  ricevono ID nuovi. Il confronto per ID su quella sezione registra un **calo che è puro artefatto**,
  bilanciato da una "sezione nuova" accanto che appare come crescita da zero.

Questo è precisamente il motivo per cui il tema per sezioni **deve** essere letto aggregato: dentro
una cella di 50 px la sezione madre e le sue figlie tornano nella stessa somma e l'artefatto si
elide (§ 5). Il confronto per sezioni non aggregato (massimo zoom, `aggregationscale → 0`) è
attendibile solo dove la sezione non è stata toccata.

### 7.3 Perché a livello di sezione la mappa NON rimappa i comuni fusi (ed è corretto)

La domanda ovvia è: perché applicare la rimappatura delle fusioni solo ai comuni e non anche al
prefisso degli ID di sezione? L'ho verificato in Trentino‑Alto Adige (76 comuni 2011 spariti per
fusione, 69.540 ab., il 6,8 % della regione):

* rimappando il prefisso, **697 su 714** sezioni 2011 trovano un ID esistente nel 2021 — sembra
  funzionare;
* ma confrontando i **centroidi**, quell'aggancio è **spazialmente sbagliato nella maggioranza dei
  casi**: spostamento mediano **1,49 lati** di sezione; solo il 41,9 % entro un quarto di lato; il
  29,7 % oltre 5 lati di distanza.

Il motivo è che nel comune nato dalla fusione la numerazione delle sezioni riparte: la vecchia
sezione 12 del comune A e la vecchia sezione 12 del comune B non possono essere entrambe la sezione
12 del comune fuso. L'ID *esiste*, ma indica un altro pezzo di territorio. **Rimappare il prefisso
a livello di sezione produrrebbe falsi accoppiamenti silenziosi**: la scelta della mappa (lasciare
gli ID intatti, far sopravvivere entrambi i lati con il padding e lasciare che l'aggregazione
spaziale li ricomponga) è la più difendibile delle tre opzioni.

Il corollario, verificato nel codice, è che **entrambe** le basi territoriali (2011 e 2021) vengono
caricate nello stesso gruppo di layer `sezioni_censimento` (`__georef_sez2011()`, `__georef_sez2021()`):
così il posizionamento per `position: "SEZ2011.1"` può risolvere anche gli ID esistenti in una sola
delle due annate — le sezioni scomparse sui poligoni 2011, quelle nuove sui poligoni 2021.
*(Questa è la lettura funzionale del perché entrambi i layer siano necessari; il meccanismo di
risoluzione dell'id all'interno del gruppo non è documentato nell'API.)*

---

## 8. Riepilogo: problema → contromisura → residuo

| Problema | Contromisura nella mappa | Residuo |
|---|---|---|
| Comune con nuovo codice per cambio provincia | snapshot statico ISTAT SITUAS (report 99, § 4.1), singolo lookup | nessuno |
| Fusione di comuni | idem — report 99 la risolve nello stesso lookup + `condense` | nessuno (comprese le 14 incorporazioni `ES`) |
| Comune nato da porzioni di territorio | nessuna contromisura possibile per costruzione | Mappano e Misiliscemi restano crescite da zero (§ 7.1) |
| Scambi/acquisizioni di territorio (`AQ`,`CE`) | report SITUAS 129 li elenca con data (utile per segnalarli) | 197 + 197 comuni (tutta la serie storica) trattati come invariati — nessun metodo di codici può correggerli, serve riproporzionalizzazione areale |
| Sezione divisa in più sezioni | `AGGREGATE\|SUM` prima del delta + griglia 50 px + `RELOCATE` | al massimo zoom (aggregazione 0) l'artefatto è visibile |
| Sezione presente in una sola annata | padding bidirezionale → outer join; entrambe le basi territoriali caricate | `filter_compare` (`like "*"` = campo non vuoto) scarta le sezioni **scomparse** ma tiene le **nuove** → bias verso la crescita nel tema a numeri assoluti |
| Denominatori piccoli nelle % | `filter("WHERE P1.1 > 50 AND P1.2 > 50")` sul tema % per sezioni; guardia `nField100Min` su `RELATIVE` | il filtro tiene solo il 17‑19 % delle sezioni, ma ~79 % della popolazione 2021 (VdA, TAA): il tema % per sezioni **non copre le zone poco abitate**, e i comuni fusi vi scompaiono del tutto (nessuna sezione ha entrambi i lati > 50) |
| Confronto di due percentuali (stranieri, istruzione) | `value100` in **coppia** → ogni anno normalizzato sul proprio totale, dopo l'aggregazione | corretto |
| Sezioni non localizzate | `select("… NOT 888888")` | < 0,1 % della popolazione |

---

## 9. Fonti dei dati

Sorgenti usate dalla mappa:

```
https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2011/all_indicatori_2011_procom.csv.gz
https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/2021/all_indicatori_2021_procom.csv.gz
https://s3.eu-west-1.amazonaws.com/data.ixmaps.com/ISTAT/Censimenti/{anno}/R{NN}_indicatori_{anno}_sezioni.csv.gz
https://s3.eu-central-1.amazonaws.com/maps.ixmaps.com/Istat/basi_territoriali_{2011,2021}/R{NN}_{11,21}_P.topojson.gz
https://cdn.jsdelivr.net/gh/gjrichter/ixmaps-data@main/by-project/censimenti-2011-2021/situas_codes.json
```

I numeri di § 7.1 e § 7.2 sono ricalcolati scaricando queste stesse tabelle e applicando la stessa
logica di rimappaggio e aggregazione descritta in § 4.

Il registro ISTAT SITUAS (report 129, tutta la serie storica dal 1991) elenca, oltre agli eventi
`AP` usati in § 4.2, le altre categorie di variazione amministrativa: `AQ` 197, `CE` 197, `CS` 342,
`ES` 348, `CD` 50, `RN` 222 comuni coinvolti. Queste categorie non sono usate dal codice attuale
(report 99 le risolve internamente per `AP`+`CS`+`ES`, § 4.1); i conteggi `AQ`/`CE` sono citati in
§ 7.1 e § 8 per quantificare il residuo non gestito dal metodo.

---

## 10. In una frase

La mappa confronta i due censimenti **allineando i codici comunali contro uno snapshot statico del
registro ISTAT SITUAS** (province, fusioni e incorporazioni risolte in un solo lookup, rigenerato
periodicamente, § 4.1) al livello dei comuni, e **rinunciando deliberatamente ad allineare le sezioni**,
affidandosi invece a un *outer join* per ID di sezione e all'**aggregazione spaziale che precede il
calcolo del delta**: poiché si somma prima e si divide dopo, la riorganizzazione delle sezioni si
annulla dentro l'unità di aggregazione. È un metodo solido — **0 % di popolazione fuori confronto a
livello comunale** (§ 7.1), residuano solo i 2 comuni nati da porzioni di territorio (Mappano,
Misiliscemi), strutturalmente irrisolvibili con una tabella di codici — i cui limiti restanti sono
circoscritti e noti: le variazioni di perimetro `AQ`/`CE` ignorate (nessun metodo di codici può
correggerle), e l'asimmetria del filtro `like "*"` sulle sezioni comparse/scomparse.
