# Smart Early Termination Update

This version is based on the V2 rule logic and only adds the Smart Early Termination system.

## What changed

After every completed trick, the server now checks:

1. **Target reached**
   - If the bidding team reaches its bid, the round ends immediately.
   - The bidding team gets exactly the bid value as points.
   - Example: Bid 6, bidding team wins 6 tricks → round ends and they get 6 points.

2. **Target impossible**
   - If the defending team wins enough tricks that the bidding team can no longer mathematically reach the bid, the round ends immediately.
   - Example: Bid 6, defending team wins 4 tricks → bidding team can only reach 5, so the round ends as a failed bid.

## What did not change from V2

- No played-card history is shown.
- Bid 5 is only available when the first 3 players have skipped.
- If all 4 players skip, the round reshuffles/redeals.
- Joker and Bound rules remain V2 logic.
