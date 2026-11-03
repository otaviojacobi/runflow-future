# Free-text workouts (R1)

How Runflow reads a workout written in pt-BR, by a coach in a hurry or in plain sentences, and turns it into a
workout structure (`api/endpoints.md` § Workout structure). Deterministic rules, no LLM (root.md §11.4).

**One grammar, three ports.** The same rules run in the web builder's quick text
(`frontend/src/domain/quicktext.ts`), in the mock's `POST /ai/workout` (`api/mock/lib/workout-text.mjs`) and in the
backend's `POST /ai/workout` (`backend/crates/domain/src/workout_text.rs`). They are kept identical by the golden
examples in **`api/workout-text-examples.json`**: each port's tests parse every example and must give exactly its
structure, name, warnings and tags. Change the grammar in all three, in the same commit, and add examples for it.

**Adding examples** (the founder sends more over time): see `api/CLAUDE.md` § Workout text examples.

## What it understands

| | Examples |
|---|---|
| Separators | `+`, `;` and new lines always split; `,` `.` ` e ` `depois` ` - ` ` / ` split once the piece has a number ("entre 4:30 e 4:40" stays together). `1)`/`2.` list numbers and `#tags` are taken out first |
| Amounts | `10'` `10 min` `1h20` `1 hora e meia` `meia hora` `90"` `1'30"` `1:23:45` · `1km` `1,5 km` `800 m` `800 metros` `1.500 m` · number words (`seis tiros`, `vinte minutos`, `dois mil metros`). A range (`30 a 40 min`, `6 a 8 km`) takes the lower amount and keeps the range in the note |
| Bare numbers | swim: meters (`400 livre`); run reps: meters from 100 (`10x400`); after a recovery marker: under 100 is seconds, else meters (`c/ 60`, `c/ 200`) |
| Repeats | `6x1km`, `6 x 1 km`, `6 vezes`, `seis tiros de 800 m`, `3 séries de`, `6 acelerações de 20"`, `3x(2km Z4 + 3' Z1)`. Nested repeats (`3x(4x400 c/ 1' + 3' entre séries)`, `2 séries de 5x400`) are written out, since the structure has one level of repeats; the rest between series replaces the last rest |
| Recoveries | after `c/`, `com`, `int`, `rec`, `pausa`, `descanso`, `/`, ` - `; or a second amount with a recovery word (`2' trote`, `15" desc`, `1' parado`, `3 min de caminhada`) or an easy word (`10x1' forte 1' leve`). `entre os tiros` / `entre séries` attach a later piece to the repeat. Intent: `recovery` (`rest` in the pool or with `descanso`, `parado`, `pausa`) |
| Intents | `aquec`/`aquecimento`/`aquecendo` → warm-up · `desaq`/`desaquecimento`/`soltar`/`solto`/`volta à calma` → cool-down · `trote`, `caminhada`, `rec` → recovery · `descanso`, `parado`, `pausa` → rest · else active |
| Paces | `@4:30`, `a 4:30`, `ritmo de 4:30`, `pace 4:30`, `4:30/km`, `5'30"/km`, `4:20-4:30`, `entre 5:00 e 5:10`; ±5 s around a single value. Run rep times: a clock under 2:30 on a distance is the rep's time (`8x400 @1:35` → 3:58/km). `5 km em 25 min`, `4 x 1600 m em 6:40` → pace |
| Zones | `Z1`–`Z5`, `zona 3`, `Z2 FC` (heart rate), `Z2 de potência`; default metric: pace (heart rate on the bike). A range (`Z4-Z5`) takes the first zone and notes the range |
| Words → zone | `regenerativo`, `bem leve`, `soltinho` → Z1 · `leve`, `fácil`, `tranquilo`, `rodagem`, `longão` → Z2 · `moderado`, `ritmo de maratona` → Z3 · `forte`, `limiar`, `ritmo de meia`, `tempo run` → Z4 · `máximo`, `sprint`, `muito forte`, `VO2` → Z5 |
| RPE, HR, power | `PSE 7`, `PSE 6-7` (note), `RPE 8/10` · `FC 140-150`, `FC entre 145 e 155 bpm`, `150 bpm`, `FC até 150` (note) · `300W`, `200-250 watts`, `95% FTP` / `90-95% do FTP` (power zone + note), `90 rpm`, `30 km/h` (notes) |
| Progressions | `progressivo de 10 km de 5:30 a 4:50` (3 paces), `Progressivo 12 km Z2 a Z4` (one part per zone), `progressivo 9 km` (Z2→Z4); parts in whole km/minutes, the remainder on the first |
| Swim | strokes `crawl`/`livre`, `costas`, `peito`, `borboleta`, `medley`, `escolha`, `pernada`, `educativo` · equipment `palmar`, `pull`/`pull buoy`, `nadadeira`/`pé de pato`, `prancha`, `snorkel` · send-off `@1:45`, `saída 1:10`, `a cada 2'` · pace per 100 m `1:40/100m` |
| Strength, mobility | one exercise per piece: `Agachamento 4x8 70% desc 90"`, `4 séries de 10 agachamentos com 20 kg`, `Supino 4x8-10 a 30kg`, `Flexão 3x máx`, `Prancha 3x45s pc`, `Remada 3x10 tempo 3-1-1`, `PSE 8`, `peso do corpo`, `80% 1RM`, `por perna`, `cada lado`, `(notes)`. Rest: `desc 90"`, `descanso de 1 minuto`, `intervalo de 2'` |
| Notes | `(text in parentheses)`, `subida`, `esteira`, `caminhada`, `educativos` (run) |

**Warnings, never errors.** A piece nobody understood is a warning with the text as typed (`blablabla`); so are numbers
left over inside an understood piece (`nos últimos 5 km`). The rest is applied. The builder shows "Não entendi: …";
the assistant returns them in `warnings`, and answers `422 ai.not_understood` only when nothing was understood.

**Names** (the assistant's `name`; the import dialog's default): `Intervalado 6×800 m`, `Intervalado 3×(4×400 m)`,
`Fartlek 10×1'`, `Séries 10×100 m` (swim), `Rodagem 8 km`, `Longão 18 km`, `Regenerativo 5 km`,
`Corrida moderada 40'`, `Ritmo forte 20'`, `Progressivo 10 km`, `Pedal leve 2h`, `Nado contínuo 1,5 km`,
`Força: Agachamento + Remada`. The biggest part names the workout (a repeat's volume against the longest step).

## Known gaps (ideas welcome as examples)

- Parts of a continuous run (`10 km com os últimos 2 km forte`, `nos últimos 5 km`): a warning for now.
- Duration ranges keep the lower bound; zone and RPE ranges keep the first value (the range goes to the note).
- One level of repeats: deeper nesting is written out (up to 50 steps per repeat).
