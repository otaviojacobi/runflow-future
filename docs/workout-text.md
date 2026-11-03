# Free-text workouts (R1, R2)

How Runflow reads a workout written in pt-BR, by a coach in a hurry or in plain sentences, and turns it into a
workout structure (`api/endpoints.md` § Workout structure). Deterministic rules, no LLM (root.md §11.4).

**One grammar, three ports.** The same rules run in the web builder's quick text
(`frontend/src/domain/quicktext.ts`), in the mock's `POST /ai/workout` (`api/mock/lib/workout-text.mjs`) and in the
backend's `POST /ai/workout` (`backend/crates/domain/src/workout_text.rs`). They are kept identical by the golden
examples in **`api/workout-text-examples.json`**: each port's tests parse every example and must give exactly its
structure, name, warnings and tags. Change the grammar in all three, in the same commit, and add examples for it.

**Adding examples** (the founder sends more over time): see `api/CLAUDE.md` § Workout text examples.

**Beyond the examples**, `node api/mock/workout-text-examples.mjs --corpus /tmp/c.json` writes random texts with the
mock's answers; `WORKOUT_TEXT_CORPUS=/tmp/c.json cargo test -p runflow-domain --test workout_text -- --ignored`
compares the backend (`backend/CLAUDE.md`). Run it after changing the grammar.

## What it understands

| | Examples |
|---|---|
| Separators | `+`, `;` and new lines always split; `,` `.` ` e ` `depois` ` - ` ` / ` split once the piece has a number ("entre 4:30 e 4:40" stays together), and so does `/` between a word and an amount (`2’ Limiar/ 1’ Trote`). `1)`/`2.` list numbers and `#tags` are taken out first |
| Typography | `’ ‘ ′ ´` → `'`, `” “ ″` → `"`, `×` → `x`, `– —` → `-`. `1’00` (no closing mark) is 1:00, `1’30”` 1:30, `1min` one minute |
| Amounts | `10'` `10 min` `1h20` `1 hora e meia` `meia hora` `90"` `1'30"` `1:23:45` · `1km` `1,5 km` `800 m` `800 metros` `1.500 m` · number words (`seis tiros`, `vinte minutos`, `dois mil metros`) |
| Ranges | the athlete picks by feel: `30 a 40 min`, `6 a 8 km`, `60-80m`, `1h a 1h30` → `{s, max_s}` / `{m, max_m}`; `15-20x`, `15 a 20 tiros` → `count` + `max_count`. Estimates, the intensity profile and FIT export use the **lower** bound; names show the range (`Intervalado 15–20×60–80 m`) |
| Bare numbers | swim: meters (`400 livre`); run reps: meters from 100 (`10x400`); after a recovery marker: under 100 is seconds, else meters (`c/ 60`, `c/ 200`) |
| Repeats | `6x1km`, `6 x 1 km`, `6 vezes`, `seis tiros de 800 m`, `3 séries de`, `6 acelerações de 20"`, `3x(2km Z4 + 3' Z1)`. Nested repeats (`3x(4x400 c/ 1' + 3' entre séries)`, `2 séries de 5x400`, `4x4x150m`) are written out, since the structure has one level of repeats; the rest between series replaces the last rest. Sets over several lines: below |
| Recoveries | after `c/`, `com`, `int`, `rec`, `pausa`, `descanso`, `/`, ` - `; or a second amount with a recovery word (`2' trote`, `15" desc`, `1' parado`, `3 min de caminhada`) or an easy word (`10x1' forte 1' leve`). `entre os tiros` / `entre séries` attach a later piece to the repeat. Intent: `recovery` (`rest` in the pool or with `descanso`, `parado`, `pausa`) |
| Intents | `aquec`/`aquecimento`/`aquecendo` → warm-up · `desaq`/`desaquecimento`/`soltar`/`solto`/`volta à calma` → cool-down · `trote`, `caminhada`, `andando`, `rec` → recovery · `descanso`, `parado`, `pausa` → rest · else active. The easy steps after the main work are the cool-down (below) |
| Paces | `@4:30`, `a 4:30`, `ritmo de 4:30`, `pace 4:30`, `4:30/km`, `5'30"/km`, `4:20-4:30`, `entre 5:00 e 5:10`; ±5 s around a single value. Run rep times: a clock under 2:30 on a distance is the rep's time (`8x400 @1:35` → 3:58/km); so is a time right after a run distance (`15x200m 53-58seg` → 4:25–4:50/km, `400m 1'30"`, `10km 50min`; `seg`, `s`, `sec`, `"`). The structure has no per-rep time target, so a rep time becomes the pace range it means. `5 km em 25 min`, `4 x 1600 m em 6:40` → pace |
| Zones | written zones only: `Z1`–`Z5`, `zona 3`, `Z2 FC` (heart rate), `Z2 de potência`; default metric: pace (heart rate on the bike). A range (`Z4-Z5`) takes the first zone and notes the range |
| Words → PSE | `leve`, `moderado`, `forte`, `limiar`, `trote`, `andando`… become a PSE target with the word as its label, never a zone (§ PSE) |
| RPE, HR, power | `PSE 7`, `PSE 6-7` (note), `RPE 8/10` (no label) · `FC 140-150`, `FC entre 145 e 155 bpm`, `150 bpm`, `FC até 150` (note) · `300W`, `200-250 watts`, `95% FTP` / `90-95% do FTP` (power zone + note), `90 rpm`, `30 km/h` (notes) |
| Progressions | `progressivo de 10 km de 5:30 a 4:50` (3 paces), `Progressivo 12 km Z2 a Z4` (one part per zone), `progressivo 9 km` (Z2→Z4); parts in whole km/minutes, the remainder on the first |
| Swim | strokes `crawl`/`livre`, `costas`, `peito`, `borboleta`, `medley`, `escolha`, `pernada`, `educativo` · equipment `palmar`, `pull`/`pull buoy`, `nadadeira`/`pé de pato`, `prancha`, `snorkel` · send-off `@1:45`, `saída 1:10`, `a cada 2'` · pace per 100 m `1:40/100m` |
| Strength, mobility | one exercise per piece: `Agachamento 4x8 70% desc 90"`, `4 séries de 10 agachamentos com 20 kg`, `Supino 4x8-10 a 30kg`, `Flexão 3x máx`, `Prancha 3x45s pc`, `Remada 3x10 tempo 3-1-1`, `PSE 8`, `peso do corpo`, `80% 1RM`, `por perna`, `cada lado`, `(notes)`. Rest: `desc 90"`, `descanso de 1 minuto`, `intervalo de 2'` |
| Notes | `(text in parentheses)`, `subida` (terrain: `60-80m subida leve` is uphill with PSE leve), `esteira`, `educativos` (run) |

## PSE (intensity words)

Words a coach writes for how hard a step is become `{type: "rpe", value, label}`: PSE on the 1–10 scale (CR-10,
the scale athletes already use to rate a session), with the word as the label people see ("PSE forte (8)" in the
app; on a watch it's in the step name). Zones stay what the coach writes as zones (`Z4`). The value also places the
step in a zone for the intensity profile, names and estimates: 1–2 → Z1, 3–4 → Z2, 5–6 → Z3, 7–8 → Z4, 9–10 → Z5.

| PSE | Words (label) |
|---|---|
| 2 | `andando`, `caminhada`, `caminhando` (caminhada) · `regenerativo`, `recuperativo` (regenerativo) · `bem leve`, `muito leve`, `soltinho`, `levinho` |
| 3 | `trote`, `trotando` (trote) · `leve`, `fácil`, `tranquilo`, `confortável`, `aeróbico` · `rodagem`, `longão`, `longo` (leve) |
| 5 | `moderado`, `médio`, `steady` |
| 6 | `ritmo de maratona` |
| 7 | `limiar`, `threshold` (limiar) · `ritmo de meia`, `ritmo de meia maratona` (ritmo de meia) · `tempo run` |
| 8 | `forte`, `intenso` |
| 9 | `muito forte`, `fortíssimo`, `VO2` |
| 10 | `máximo`, `máx`, `sprint` |

Phrases win over single words, adjectives over nouns (`rodagem leve` is "leve"), and a written target (pace, zone,
heart rate, power, `PSE 7`) over all of them. `trote` and `andando` also make the step a recovery. Choosing a
different PSE in the editor drops the word.

## Sets over several lines (R2)

Coaches write a set as a count on its own line, its runs one per line, and the rests last:

```
10’ Aquecimento
3x
500m Moderado
300m Forte
Desc. 1’00 & 2’00”
5’ Leve
```

- **A count line** (`3x`, `15-20x`, `3 séries:`) opens a set: the lines below it are its rounds (`3x200m Forte` inside
  is written out, like any nested repeat; a short easy line after a run is its recovery, as in `3x(…)`).
- **`Desc. A & B`** (also `Desc`, `descanso`, `pausa`; `1’00`, `1’30”`, `1min`, `90"`) closes the set above it:
  **A** is the rest after each run (a step with no rest after it), **B** the rest after the whole round (it replaces
  the last A). `Desc. A` alone: A after each run. If every run already has its rest, the rest goes last. A `Desc.`
  line right after a one-line repeat that has no rests (`4x4x150m`, `15x200m 53-58seg`) gives that repeat its rests
  the same way. Each part is a step: a time alone is a timed **rest** (`1’30”`); a distance, or an intensity word,
  is an **active recovery** (`Desc. 200m Trote`: 200 m of trote, PSE 3; `Desc. 2' caminhando`); a word can say it
  (`1' parado` is a rest). `Desc. 200m trote & 3'`: trote after each run, 3' rest after the round.
- **A named block with a total**: a line of any words and one amount, with no intensity or intent word
  (`Fartlek 28min`, `Cruise Interval 51min`, `Bloco do sábado 30min`), followed by
  - a count line: the set takes the lines whose rounds fit the total (count × their sum ≤ total), stopping when it's
    reached (`7x` + `3’ Moderado` + `1’ Leve` = 28 min, so `5’ Leve` after it is the cool-down);
  - a repeat line that makes the total (`7x(3' + 1')`);
  - or one alternating pair on one line (`2’ Limiar/ 1’ Trote`): repeated ⌊total ÷ pair⌋ times (51 min → 17×).

  The words are only a label (there is no list of training names): they become the repeat's `note` and name the
  workout (`Cruise Interval 51'`). When the lines don't fill the total in the same unit, the line is an ordinary step.
- **Where a set ends**: at its `Desc.` line; else where its total is reached; else at the next count line; else at the
  end of the text minus the trailing easy lines (the cool-down). When several easy lines trail, the first one, if it
  is short (≤ 5 min or 1 km, not a cool-down word), stays in the set as its recovery
  (`3x` + `1km forte` + `2' trote` + `10' desaq`).
- **Cool-down**: the easy steps after the main work (a repeat, or an active step that isn't easy) are the cool-down,
  however many (`5’ Leve` + `3' Andando`): PSE ≤ 3, Z1–Z2, a recovery word or a cool-down word. The warm-up is what
  the coach calls it (`Aquecimento`).

**Warnings, never errors.** A piece nobody understood is a warning with the text as typed (`blablabla`); so are numbers
left over inside an understood piece (`nos últimos 5 km`). The rest is applied. The builder shows "Não entendi: …";
the assistant returns them in `warnings`, and answers `422 ai.not_understood` only when nothing was understood.

**Names** (the assistant's `name`; the import dialog's default): `Intervalado 6×800 m`, `Intervalado 3×(4×400 m)`,
`Intervalado 3×1,5 km` (a set over several lines with different runs: what each round adds up to),
`Intervalado 15–20×60–80 m`, `Cruise Interval 51'` (a named block), `Fartlek 10×1'`, `Séries 10×100 m` (swim),
`Rodagem 8 km`, `Rodagem 30–40'`, `Longão 18 km`, `Regenerativo 5 km`, `Corrida moderada 40'`, `Ritmo forte 20'`,
`Progressivo 10 km`, `Pedal leve 2h`, `Nado contínuo 1,5 km`, `Força: Agachamento + Remada`. The biggest part names
the workout (a repeat's volume against the longest step).

## Known gaps (ideas welcome as examples)

- Parts of a continuous run (`10 km com os últimos 2 km forte`, `nos últimos 5 km`): a warning for now.
- Zone and RPE ranges keep the first value (the range goes to the note).
- One level of repeats: deeper nesting is written out (up to 50 steps per repeat); an inner count range
  (`3x(15-20x…)`) keeps its lower count.
- A named block's label can't hold an intensity or intent word (`Bloco forte 20min` is a 20' forte step).
- `Desc. A & B` needs the `&` (`Desc. 1' e 2'` splits at "e").
- An alternating pair without a total (`2' limiar / 1' trote` alone) is just two steps.
