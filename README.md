# Bound Card Game

A real-time 4-player online multiplayer implementation of **Bound**.

## Major rules included

- 36-card custom deck.
- 4 active players, opposite players are teammates.
- 3-3-3 dealing pattern.
- Bidding starts from the player to the right of the shuffler/dealer.
- Minimum bid is 6.
- Bid 5 is only available if the first 3 players skip.
- If all 4 players skip, the cards are reshuffled and redealt.
- The winning bidder chooses the **Trump Suit** before play starts.
- Bound replaces a 9-trick bid and still routes through Trump Suit selection.
- In-game Bound can be called during play up to trick 7, following the original Bound rules.
- Smart Early Termination is preserved:
  - The round ends immediately when the bidding team reaches its target.
  - The round ends immediately when the bidding team can no longer mathematically reach its target.
- Played-card history is hidden; only the current trick pile is shown.
- Spectator mode hides all player hands.
- Host controls: kick users or move active players to spectators.

## Run locally

```powershell
npm.cmd run install:all
npm.cmd run dev
```

Open:

```text
http://localhost:5173
```

## Build for deployment

```powershell
npm.cmd run build
npm.cmd start
```

Deploy as a Node.js web service, not a static-only website.
