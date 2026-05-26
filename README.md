<img width="1205" height="880" alt="Gemini_Generated_Image_93yvce93yvce93yv" src="https://github.com/user-attachments/assets/a0504cd0-6121-4e6a-bcfb-5cbff6fdc9f0" />

How "Bound" Came to Life: The Backstory ☕

Honestly? This whole project started because we were completely losing our minds with boredom between lectures at uni. Instead of actually paying attention or doing something productive, we spent every free minute huddled over a deck of cards, tweaking rules, arguments over trumps, and playing this custom version of Hokm until the cards were literally falling apart.

Eventually, we got tired of carrying a physical deck everywhere (and getting side-eyed by professors), so we figured, *"We're literally studying this stuff, why don't we just build an online version so we can play on our laptops?"* That's how **Bound** went from a time-killer in the university common room to a fully coded multiplayer website.

#### What We Actually Built (The Dev Breakdown):

* **The Custom 36-Card Chaos:** We ditched the standard deck. It's 6-A for Spades and Hearts, 7-A for Clubs and Diamonds, plus a Black and Red Joker thrown in just to mess with everyone's strategy.
* **The Anti-Clockwise Grind:** Turns, bidding, and card-throwing strictly move anti-clockwise. No exceptions.
* **The "15-Point" Joker Traps:** If you hold the Black Joker past Round 3, or if you're dumb enough to save the Red Joker for the absolute final trick (Round 9), the game calls a foul, ends the round, and hands the other team a free +15 points.
* **Smart Rage-Quitting (Early Termination):** We coded a math checker that runs after every single trick. The exact second a team hits their bid target or the exact moment it becomes mathematically impossible for them to win the round automatically cuts short, updates the scores, and shuffles a fresh deck. No wasted time.
* **Going "Bound":** If you're feeling cocky before Round 7 and think your hand can sweep all 9 tricks, you call **Bound**. Pull it off? You win the whole match on the spot. Fail even one trick? Instant match over, you lose. First team to 54 standard points wins otherwise.

It started as a joke to pass the time between classes, but now it's a fully functional, highly competitive mental battlefield. Pull up a seat in the lobby, don't get trapped by the Jokers, and let's see who actually owns the table.
