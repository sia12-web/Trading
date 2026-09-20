# DOW District — Market Game

Strategic auction-trading prototype. You do not watch a chart. You walk **Price** through an industrial New York district that *is* the DOW.

This folder is a standalone browser game. It does not modify or deploy the production trading app.

## Goals

- Make auction-market theory physical: Price visits stores; volume and time decide whether the offer is real.
- Feel like a live floor at the **9:30 AM New York** cash open — bell, shutters, shift coming on — not a spreadsheet skin.
- Start with **DOW only**. NASDAQ, gold, and oil exist as locked doors until this loop is right.
- Embody the desk’s existing tools: yesterday NYC profile, 5-day FRVP (POC / HVN / LVN), 5-month anchored VWAP with σ bands.

## The three factors

| Factor | In the world | On the desk |
| --- | --- | --- |
| **Price** | The player. Price is advertising. Stores bid for your attention; walking in is showing up at a level. | The print. |
| **Volume** | Divergence. Does size confirm the store’s nature, or is it talking louder than the tape? HVN/POC want participation. LVN should stay thin — a flood means the vacuum is filling. | Volume profile nodes, CVD-style confirmation. |
| **Time** | Opportunity. Value is made with time. Has this price lived here long enough to be fair *today*, or is there still time to act? | TPO / session progress / IB clock. |

Buy and sell are **taking the auction**, not filling a form. Quality of the print comes from those two meters, not from a P&L table.

## Store layout

The district is a walled mill yard seen from a Clash of Clans isometric camera. Cash open is 9:30 AM NYC. Yesterday sits on the south pads, five-day on the north, 5-month AVWAP on the west spire.

### Yesterday NYC session — south row (three stores)

Each store is one node from yesterday’s Regular Trading Hours volume profile (09:30–16:00 ET), same construction as the desk: volume distributed across price buckets, 70% value area grown from the peak.

| Store | Node | Building |
| --- | --- | --- |
| **Y-HVN Foundry** | High volume node | Furnaces, sparks, crowded steel — acceptance, slow/fill |
| **Y-POC Hall** | Point of control / fair value | Columned auction hall — highest traded volume yesterday |
| **Y-LVN Dock** | Low volume node | Empty dock, thin tape — vacuum / single print |

### Five-day lookback — north row (three stores)

Composite **5-day FRVP** (five NYC cash sessions), the desk’s short-term money map.

| Store | Node | Building |
| --- | --- | --- |
| **5D HVN Yard** | High volume node | Beam yard and crane — second distribution |
| **5D POC Mill** | Point of control | Sawtooth mill — composite fair value |
| **5D LVN Alley** | Low volume node | Gap between sheds — air pocket / fast rejection |

### Last five months — west spire (live AVWAP)

**5-month anchored VWAP**: cash-open anchor five months back, \(\sum P V / \sum V\), with ±1σ annexes. The spire and rings **update on every live print**, the same way the desk’s macro AVWAP breathes.

| Store | Node | Building |
| --- | --- | --- |
| **5M AVWAP Spire** | Anchored VWAP | Lattice tower, moving rings |
| **+1σ Band** | Upper 1σ | Premium annex |
| **−1σ Band** | Lower 1σ | Discount annex |

## How to play

```bash
cd market-game
npm install
npm run dev
```

Open `http://localhost:5173`.

Clash of Clans camera: isometric look-down over the whole walled yard. Price is a unit on the floor. HUD sits on the edges.

1. Hub: four market buildings. Only **DOW** unlocks. Click it or **ENTER DOW DISTRICT**.
2. District starts **pre-open**. Clock runs to 9:30 AM New York.
3. **Market open**: bell, shutters lift, floor comes alive — still looking down on the whole village.
4. **WASD** moves Price (screen-relative). Click a store to inspect, or click the ground to walk there.
5. Read **volume (divergence)** and **time (fair / still time)**. **B** buy, **F** sell.
6. Skip cinematic with **Skip to open**.

`npm test` checks that POC / HVN / LVN / AVWAP math matches the desk’s rules (POC inside 70% value, HVN ≠ POC, AVWAP ticks toward new volume).

## Stack

Vite · React 18 · Three.js · React Three Fiber · postprocessing. No production app imports, no Railway deploy.
