import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3001;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { 
    origin: "https://theboundgame.vercel.app",
    methods: ["GET", "POST"],
    credentials: true
  } 
});

const rooms = new Map();
const suits = ['spades', 'hearts', 'clubs', 'diamonds'];
const TURN_SECONDS = 15;
const ranks = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const rankValue = Object.fromEntries(ranks.map((r, i) => [r, i + 6]));
const suitSymbols = { spades: '♠', hearts: '♥', clubs: '♣', diamonds: '♦' };

function code() {
  let c = '';
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  do {
    c = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(c));
  return c;
}

function rightOf(i) { return (i + 1) % 4; } // anti-clockwise direction in this app
function teamOf(i) { return i % 2; }
function teamLabel(team) { return team === 0 ? 'Team A' : 'Team B'; }
function otherTeamOfPlayer(i) { return 1 - teamOf(i); }
function isJoker(card) { return card.type === 'blackJoker' || card.type === 'redJoker'; }
function emptySeat() { return { id: null, name: 'Open seat', connected: false, ready: false, hand: [], empty: true }; }
function isActiveSeat(p) { return Boolean(p && !p.empty && p.id); }
function occupiedSeatCount(room) { return room.players.filter(isActiveSeat).length; }
function allActiveSeatsReady(room) { return room.players.length === 4 && room.players.every(p => isActiveSeat(p) && p.connected && p.ready); }
function seatName(room, idx) { return isActiveSeat(room.players[idx]) ? room.players[idx].name : `Seat ${idx + 1}`; }

function createDeck() {
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      if ((suit === 'clubs' || suit === 'diamonds') && rank === '6') continue;
      deck.push({ id: `${rank}-${suit}`, rank, suit, label: `${rank}${suitSymbols[suit]}`, type: 'normal' });
    }
  }
  deck.push({ id: 'black-joker', rank: 'BJ', suit: 'joker', label: 'Black Joker', type: 'blackJoker' });
  deck.push({ id: 'red-joker', rank: 'RJ', suit: 'joker', label: 'Red Joker', type: 'redJoker' });
  return deck;
}

function shuffle(deck) {
  const a = [...deck];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function roomPublic(room, socketId = null) {
  const meSeat = room.players.findIndex(p => isActiveSeat(p) && p.id === socketId);
  const spectator = room.spectators?.find(s => s.id === socketId) || null;
  const meIsHost = socketId === room.hostId;

  const players = room.players.map((p, idx) => {
    const active = isActiveSeat(p);
    return {
      id: meIsHost && active ? p.id : null,
      name: active ? p.name : 'Open seat',
      seat: idx,
      empty: !active,
      connected: active ? Boolean(p.connected) : false,
      ready: active ? Boolean(p.ready) : false,
      team: teamOf(idx)
    };
  });

  const spectators = (room.spectators || []).map(s => ({
    id: meIsHost ? s.id : null,
    name: s.name,
    connected: s.connected
  }));

  return {
    code: room.code,
    hostId: meIsHost ? room.hostId : null,
    meIsHost,
    meRole: meSeat >= 0 ? 'player' : spectator ? 'spectator' : 'unknown',
    players,
    spectators,
    meSeat: meSeat >= 0 ? meSeat : null,
    // Spectator security: only an active player receives their own hidden hand.
    hand: meSeat >= 0 ? room.players[meSeat].hand : [],
    phase: room.phase,
    message: room.message,
    scores: room.scores,
    dealer: room.dealer,
    cutter: room.cutter,
    bidStarter: room.bidStarter,
    currentBid: room.currentBid,
    currentBidder: room.currentBidder,
    biddingTurn: room.biddingTurn,
    skipped: room.skipped,
    bidWinner: room.bidWinner,
    trump: room.trump,
    leader: room.leader,
    turn: room.turn,
    trick: room.trick,
    trickNumber: room.trickNumber,
    tricksWon: room.tricksWon,
    blackJokerUsed: room.blackJokerUsed,
    bound: room.bound,
    gameWinnerTeam: room.gameWinnerTeam,
    gameLoserTeam: room.gameLoserTeam,
    gameOverReason: room.gameOverReason || null,
    endedByBound: Boolean(room.endedByBound),
    canStartNewGame: room.phase === 'gameover' && meIsHost,
    roundBid: room.roundBid,
    nextDealer: room.nextDealer,
    roundNumber: room.roundNumber,
    // Chat is spectator-only. Active players receive no chat payload.
    chat: spectator ? (room.chat || []) : [],
    noCardHistory: true,
    timer: room.timer ? { deadline: room.timer.deadline, duration: room.timer.duration, key: room.timer.key } : null
  };
}

function emitRoom(room) {
  ensureRoomTimer(room);
  for (const p of room.players) {
    if (isActiveSeat(p) && p.id) io.to(p.id).emit('state', roomPublic(room, p.id));
  }
  for (const spectator of room.spectators || []) {
    if (spectator.id) io.to(spectator.id).emit('state', roomPublic(room, spectator.id));
  }
}

function clearRoundStateToLobby(room, message) {
  room.players.forEach(p => { if (isActiveSeat(p)) { p.hand = []; p.ready = false; } });
  room.phase = 'lobby';
  room.dealer = null;
  room.cutter = null;
  room.bidStarter = null;
  room.currentBid = null;
  room.currentBidder = null;
  room.biddingTurn = null;
  room.skipped = [false, false, false, false];
  room.bidWinner = null;
  room.trump = null;
  room.leader = null;
  room.turn = null;
  room.trick = [];
  room.trickNumber = 0;
  room.tricksWon = [0, 0];
  room.blackJokerUsed = false;
  room.bound = false;
  room.roundBid = null;
  room.nextDealer = null;
  room.deck = [];
  room.message = message;
}

function makeRoom(hostId, name) {
  const players = Array.from({ length: 4 }, () => emptySeat());
  players[0] = { id: hostId, name, connected: true, ready: false, hand: [], empty: false };
  const room = {
    code: code(),
    hostId,
    players,
    spectators: [],
    phase: 'lobby',
    message: 'Waiting for 4 players.',
    scores: [0, 0],
    dealer: null,
    cutter: null,
    bidStarter: null,
    currentBid: null,
    currentBidder: null,
    biddingTurn: null,
    skipped: [false, false, false, false],
    bidWinner: null,
    trump: null,
    leader: null,
    turn: null,
    trick: [],
    trickNumber: 0,
    tricksWon: [0, 0],
    blackJokerUsed: false,
    bound: false,
    roundBid: null,
    gameWinnerTeam: null,
    gameLoserTeam: null,
    gameOverReason: null,
    endedByBound: false,
    roundNumber: 0,
    nextDealer: null,
    deck: [],
    chat: [],
    timer: null
  };
  rooms.set(room.code, room);
  return room;
}

function resetForNewRound(room, dealer = null) {
  clearRoomTimer(room);
  room.roundNumber += 1;
  room.players.forEach(p => { if (isActiveSeat(p)) p.hand = []; });
  room.phase = 'cut';
  room.dealer = dealer ?? Math.floor(Math.random() * 4);
  room.cutter = rightOf(room.dealer);
  room.bidStarter = rightOf(room.dealer);
  room.currentBid = null;
  room.currentBidder = null;
  room.biddingTurn = room.bidStarter;
  room.skipped = [false, false, false, false];
  room.bidWinner = null;
  room.trump = null;
  room.leader = null;
  room.turn = null;
  room.trick = [];
  room.trickNumber = 0;
  room.tricksWon = [0, 0];
  room.blackJokerUsed = false;
  room.bound = false;
  room.roundBid = null;
  room.gameWinnerTeam = null;
  room.gameLoserTeam = null;
  room.gameOverReason = null;
  room.endedByBound = false;
  room.nextDealer = null;
  room.deck = shuffle(createDeck());
  room.message = `${seatName(room, room.dealer)} shuffled. ${seatName(room, room.cutter)} must cut the deck.`;
}

function deal(room) {
  // 3-3-3 deal pattern, moving anti-clockwise from the player right of the dealer.
  let deckIndex = 0;
  for (let batch = 0; batch < 3; batch++) {
    for (let offset = 1; offset <= 4; offset++) {
      const playerIdx = (room.dealer + offset) % 4;
      if (isActiveSeat(room.players[playerIdx])) room.players[playerIdx].hand.push(...room.deck.slice(deckIndex, deckIndex + 3));
      deckIndex += 3;
    }
  }
  room.phase = 'bidding';
  room.message = `${seatName(room, room.bidStarter)} starts bidding. Bid 6 or higher, or skip.`;
}

function nextUnskippedBidder(room, from) {
  for (let step = 1; step <= 4; step++) {
    const idx = (from + step) % 4;
    if (!room.skipped[idx]) return idx;
  }
  return null;
}

function activeBidders(room) {
  return [0, 1, 2, 3].filter(i => !room.skipped[i]);
}

function skipCount(room) {
  return room.skipped.filter(Boolean).length;
}

function getMinimumBid(room, playerIdx) {
  if (room.currentBid !== null && room.currentBid !== 'BOUND') return room.currentBid + 1;
  // The 5-bid is only available when the previous 3 players skipped and this player is the last unskipped player.
  if (room.currentBid === null && skipCount(room) === 3 && !room.skipped[playerIdx]) return 5;
  return 6;
}

function finalizeBid(room, winner) {
  room.bidWinner = winner;
  room.roundBid = room.currentBid;

  if (room.currentBid === 'BOUND') {
    room.bound = true;
    room.roundBid = 'BOUND';
    room.trump = null;
    room.phase = 'chooseTrump';
    room.message = `${seatName(room, winner)} won the auction with Bound. Choose the Trump Suit before play starts.`;
    return;
  }

  room.phase = 'chooseTrump';
  room.message = `${seatName(room, winner)} won the bid with ${room.currentBid}. Choose the Trump Suit.`;
}

function allSkippedNoBid(room) {
  return room.currentBid === null && room.skipped.every(Boolean);
}

function redealAfterAllSkipped(room) {
  clearRoomTimer(room);
  room.players.forEach(p => { if (isActiveSeat(p)) p.hand = []; });
  room.currentBid = null;
  room.currentBidder = null;
  room.biddingTurn = room.bidStarter;
  room.skipped = [false, false, false, false];
  room.bidWinner = null;
  room.trump = null;
  room.leader = null;
  room.turn = null;
  room.trick = [];
  room.trickNumber = 0;
  room.tricksWon = [0, 0];
  room.blackJokerUsed = false;
  room.bound = false;
  room.roundBid = null;
  room.deck = shuffle(createDeck());
  deal(room);
  room.message = `Everyone skipped. The cards were reshuffled and redealt. ${seatName(room, room.bidStarter)} starts bidding again.`;
}

function checkBiddingEnd(room) {
  if (allSkippedNoBid(room)) {
    redealAfterAllSkipped(room);
    return;
  }

  const active = activeBidders(room);
  if (room.currentBidder !== null && active.length === 1 && active[0] === room.currentBidder) {
    finalizeBid(room, room.currentBidder);
  }
}

function cardPower(card, trump, leadSuit) {
  if (card.type === 'redJoker') return 500;
  if (card.type === 'blackJoker') return 400;
  if (card.suit === trump) return 300 + rankValue[card.rank];
  if (card.suit === leadSuit) return 100 + rankValue[card.rank];
  return rankValue[card.rank];
}

function cardBeats(a, b, trump, leadSuit) {
  if (!b) return true;
  return cardPower(a.card, trump, leadSuit) > cardPower(b.card, trump, leadSuit);
}

function playerHasBothJokers(room, playerIdx) {
  const hand = room.players[playerIdx]?.hand || [];
  return hand.some(c => c.type === 'blackJoker') && hand.some(c => c.type === 'redJoker');
}

function findHolder(room, cardType) {
  return room.players.findIndex(p => p.hand.some(c => c.type === cardType));
}

function illegalJokerPenalty(room, offendingPlayer, reason) {
  const offendingTeam = teamOf(offendingPlayer);
  const otherTeam = 1 - offendingTeam;
  room.scores[otherTeam] += 15;
  room.phase = room.scores[otherTeam] >= 54 ? 'gameover' : 'roundover';
  if (room.phase === 'gameover') {
    room.gameWinnerTeam = otherTeam;
    room.scores[otherTeam] = Math.max(room.scores[otherTeam], 54);
  }
  room.nextDealer = rightOf(offendingPlayer);
  room.message = `${reason} Round ends immediately. ${teamLabel(otherTeam)} gets 15 points. ${teamLabel(offendingTeam)} gets 0 for the round.`;
}

function finishMatch(room, winnerTeam, message, loserTeam = null, reason = 'bound') {
  room.phase = 'gameover';
  room.gameWinnerTeam = winnerTeam;
  room.gameLoserTeam = loserTeam;
  room.gameOverReason = reason;
  room.endedByBound = reason === 'bound';

  // Bound is an instant match-ending condition. The scoreboard must clearly
  // show the winning team as having won the match, even if the previous score
  // was below 54.
  room.scores[winnerTeam] = 54;

  // Clear active round state so no remaining hand/table state can block the
  // Game Over UI or the Start New Game flow.
  room.trick = [];
  room.turn = null;
  room.leader = null;
  room.nextDealer = null;
  room.message = `${message} Host can start a new game.`;
}

function resetMatchForReplay(room) {
  clearRoomTimer(room);
  room.scores = [0, 0];
  room.gameWinnerTeam = null;
  room.gameLoserTeam = null;
  room.gameOverReason = null;
  room.endedByBound = false;
  room.roundNumber = 0;
  room.nextDealer = null;
  clearRoundStateToLobby(room, 'New match lobby created. All active players must ready up before the host starts.');
}

function checkStartOfTrickPenalty(room) {
  // If a player is forced to start trick 3 while holding the Black Joker, the round ends immediately.
  if (room.phase === 'playing' && room.trickNumber === 3 && room.trick.length === 0) {
    const leader = room.leader;
    if ((room.players[leader]?.hand || []).some(c => c.type === 'blackJoker')) {
      illegalJokerPenalty(room, leader, `${seatName(room, leader)} had to start trick 3 while holding the Black Joker.`);
      return true;
    }
  }

  // Red Joker cannot be held into trick 9.
  if (room.phase === 'playing' && room.trickNumber === 9 && room.trick.length === 0) {
    const holder = findHolder(room, 'redJoker');
    if (holder !== -1) {
      illegalJokerPenalty(room, holder, `${seatName(room, holder)} held the Red Joker until the last trick.`);
      return true;
    }
  }

  return false;
}

function checkEndOfTrickPenalty(room) {
  // At the end of trick 3, Black Joker must already be gone.
  if (room.phase === 'playing' && room.trickNumber === 3 && !room.blackJokerUsed) {
    const holder = findHolder(room, 'blackJoker');
    if (holder !== -1) {
      illegalJokerPenalty(room, holder, `${seatName(room, holder)} still had the Black Joker after trick 3.`);
      return true;
    }
  }
  return false;
}

function validPlay(room, playerIdx, card) {
  if (room.phase !== 'playing') return { ok: false, msg: 'Not playing phase.' };
  if (room.turn !== playerIdx) return { ok: false, msg: 'Not your turn.' };

  const isLead = room.trick.length === 0;
  if (isJoker(card) && isLead) return { ok: false, msg: 'Jokers cannot start a trick. They can only defend.' };

  if (card.type === 'redJoker' && !room.blackJokerUsed && !playerHasBothJokers(room, playerIdx)) {
    return { ok: false, msg: 'Red Joker can only be used after the Black Joker, unless you hold both Jokers.' };
  }

  if (card.type === 'blackJoker' && room.trickNumber > 3) {
    return { ok: true, illegalPenalty: true, msg: 'Black Joker was used after the first 3 tricks.' };
  }
  if (card.type === 'redJoker' && room.trickNumber === 9) {
    return { ok: true, illegalPenalty: true, msg: 'Red Joker was used in the last trick.' };
  }

  // If bid is 8 or 9, the starting player of the first trick must lead a Trump Suit card if they have one.
  const numericBid = Number(room.roundBid);
  if (isLead && Number.isInteger(numericBid) && numericBid >= 8 && room.trickNumber === 1) {
    const hasTrump = (room.players[playerIdx]?.hand || []).some(c => c.type === 'normal' && c.suit === room.trump);
    if (hasTrump && !(card.type === 'normal' && card.suit === room.trump)) {
      return { ok: false, msg: 'Because the bid is 8 or more, the first leader must start with a Trump Suit card if they have one.' };
    }
  }

  // Jokers are suit-less and may be played defensively even if the player has the lead suit.
  if (!isLead && card.type === 'normal') {
    const leadSuit = room.trick[0].card.suit;
    const hasLeadSuit = (room.players[playerIdx]?.hand || []).some(c => c.type === 'normal' && c.suit === leadSuit);
    if (hasLeadSuit && card.suit !== leadSuit) {
      return { ok: false, msg: `You must play ${leadSuit} if you have it.` };
    }
  }

  return { ok: true };
}

function finishTrick(room) {
  const leadSuit = room.trick.find(play => play.card.type === 'normal')?.card.suit || null;
  let best = room.trick[0];
  for (const play of room.trick.slice(1)) {
    if (cardBeats(play, best, room.trump, leadSuit)) best = play;
  }

  const winner = best.player;
  room.tricksWon[teamOf(winner)] += 1;
  room.trick = [];

  if (room.bound) {
    const bidderTeam = teamOf(room.bidWinner);
    if (teamOf(winner) !== bidderTeam) {
      const winningTeam = 1 - bidderTeam;
      finishMatch(room, winningTeam, `Bound failed. ${teamLabel(winningTeam)} wins the game.`, bidderTeam, 'bound');
      return;
    }

    // Bound success must end the match immediately after the 9th won trick,
    // without falling through to normal round scoring or next-round logic.
    if (room.tricksWon[bidderTeam] === 9) {
      finishMatch(room, bidderTeam, `Bound succeeded. ${teamLabel(bidderTeam)} wins the game.`, 1 - bidderTeam, 'bound');
      return;
    }
  }

  if (checkEndOfTrickPenalty(room)) return;

  // Smart Early Termination: after every completed trick, stop immediately
  // when the bidding team has made the contract or can no longer make it.
  if (checkSmartEarlyTermination(room)) return;

  if (room.trickNumber >= 9) return scoreRound(room);

  room.trickNumber += 1;
  room.leader = winner;
  room.turn = winner;
  room.message = `${seatName(room, winner)} starts trick ${room.trickNumber}.`;
  checkStartOfTrickPenalty(room);
}

function checkSmartEarlyTermination(room) {
  if (room.bound || room.roundBid === 'BOUND') return false;

  const targetTricks = Number(room.roundBid);
  if (!Number.isInteger(targetTricks)) return false;

  const totalTricksPerRound = 9;
  const biddingTeam = teamOf(room.bidWinner);
  const opposingTeam = 1 - biddingTeam;
  const tricksWonBiddingTeam = room.tricksWon[biddingTeam];
  const tricksWonOpposingTeam = room.tricksWon[opposingTeam];

  // Condition A: the bidding team reached the target.
  // The round ends immediately and the score is capped at the declared bid.
  if (tricksWonBiddingTeam >= targetTricks) {
    applySuccessfulBid(room, targetTricks, biddingTeam);
    return true;
  }

  const maxPossibleRemainingTricks = totalTricksPerRound - tricksWonBiddingTeam - tricksWonOpposingTeam;
  const targetImpossible = (tricksWonBiddingTeam + maxPossibleRemainingTricks) < targetTricks
    || tricksWonOpposingTeam > (totalTricksPerRound - targetTricks);

  // Condition B: the defenders have locked the bidding team out mathematically.
  if (targetImpossible) {
    applyFailedBid(room, targetTricks, biddingTeam, opposingTeam, true);
    return true;
  }

  return false;
}

function applySuccessfulBid(room, bid, bidderTeam) {
  room.scores[bidderTeam] += bid;
  room.trick = [];
  room.message = `Bid reached. ${teamLabel(bidderTeam)} gets exactly ${bid} points. The remaining cards are skipped.`;
  finishRoundTransition(room);
}

function applyFailedBid(room, bid, bidderTeam, otherTeam, early = false) {
  if (room.roundNumber === 1) {
    room.scores[otherTeam] += bid;
    room.message = `${early ? 'Bid became impossible' : 'First-round bid failed'}. ${teamLabel(otherTeam)} gets ${bid} points; bidding team gets 0.`;
  } else {
    room.scores[bidderTeam] -= bid;
    room.scores[otherTeam] += bid * 2;
    room.message = `${early ? 'Bid became impossible' : 'Bid failed'}. ${teamLabel(bidderTeam)} gets -${bid}; ${teamLabel(otherTeam)} gets ${bid * 2}.`;
  }
  finishRoundTransition(room);
}

function finishRoundTransition(room) {
  if (room.scores[0] >= 54 || room.scores[1] >= 54) {
    room.phase = 'gameover';
    room.gameWinnerTeam = room.scores[0] >= 54 ? 0 : 1;
    room.scores[room.gameWinnerTeam] = Math.max(room.scores[room.gameWinnerTeam], 54);
    room.message += ` ${teamLabel(room.gameWinnerTeam)} reached 54 points and wins the game.`;
  } else {
    room.phase = 'roundover';
    room.nextDealer = rightOf(room.bidWinner);
  }
}

function scoreRound(room) {
  const bidderTeam = teamOf(room.bidWinner);
  const otherTeam = 1 - bidderTeam;

  if (room.bound) {
    finishMatch(room, bidderTeam, `Bound succeeded. ${teamLabel(bidderTeam)} wins the game.`, otherTeam, 'bound');
    return;
  }

  const bid = Number(room.roundBid);
  const tricks = room.tricksWon[bidderTeam];
  const success = tricks >= bid;

  if (success) {
    applySuccessfulBid(room, bid, bidderTeam);
  } else {
    applyFailedBid(room, bid, bidderTeam, otherTeam, false);
  }
}


function getTimerKey(room) {
  if (!room || room.players.length !== 4) return null;
  if (room.phase === 'bidding' && room.biddingTurn !== null) return `bidding:${room.biddingTurn}:${room.currentBid ?? 'none'}:${room.skipped.join('')}`;
  if (room.phase === 'chooseTrump' && room.bidWinner !== null) return `chooseTrump:${room.bidWinner}:${room.roundBid}`;
  if (room.phase === 'playing' && room.turn !== null) return `playing:${room.turn}:${room.trickNumber}:${room.trick.length}`;
  return null;
}

function clearRoomTimer(room) {
  if (room?.timer?.id) clearTimeout(room.timer.id);
  if (room) room.timer = null;
}

function ensureRoomTimer(room) {
  const key = getTimerKey(room);
  if (!key) {
    clearRoomTimer(room);
    return;
  }
  if (room.timer?.key === key && room.timer.deadline > Date.now()) return;
  clearRoomTimer(room);
  room.timer = {
    key,
    duration: TURN_SECONDS,
    deadline: Date.now() + TURN_SECONDS * 1000,
    id: setTimeout(() => handleTimerExpired(room.code, key), TURN_SECONDS * 1000)
  };
}

function handleTimerExpired(roomCode, key) {
  const room = rooms.get(roomCode);
  if (!room || room.timer?.key !== key || getTimerKey(room) !== key) return;
  clearRoomTimer(room);

  if (room.phase === 'bidding') {
    const idx = room.biddingTurn;
    if (idx !== null) {
      room.skipped[idx] = true;
      room.message = `${seatName(room, idx)} timed out and skipped.`;
      checkBiddingEnd(room);
      if (room.phase === 'bidding') room.biddingTurn = nextUnskippedBidder(room, idx);
    }
  } else if (room.phase === 'chooseTrump') {
    const idx = room.bidWinner;
    const suit = chooseDefaultTrump(room, idx);
    applyTrumpChoice(room, idx, suit, true);
  } else if (room.phase === 'playing') {
    const idx = room.turn;
    const card = chooseAutoCard(room, idx);
    if (card) {
      playCardFromHand(room, idx, card.id, true);
    } else {
      room.message = `${room.players[idx]?.name || 'A player'} timed out, but no valid card could be auto-played.`;
    }
  }

  emitRoom(room);
}

function chooseDefaultTrump(room, playerIdx) {
  const hand = room.players[playerIdx]?.hand || [];
  const suitScore = Object.fromEntries(suits.map(s => [s, 0]));
  for (const card of hand) {
    if (card.type === 'normal') suitScore[card.suit] += 1;
  }
  return [...suits].sort((a, b) => suitScore[b] - suitScore[a] || suits.indexOf(a) - suits.indexOf(b))[0] || 'spades';
}

function applyTrumpChoice(room, idx, suit, automatic = false) {
  if (room.phase !== 'chooseTrump' || idx !== room.bidWinner || !suits.includes(suit)) return false;
  room.trump = suit;
  room.phase = 'playing';
  room.leader = rightOf(room.bidWinner);
  room.turn = room.leader;
  room.trickNumber = 1;
  const autoText = automatic ? `${seatName(room, idx)} timed out, so ${suit} was selected automatically as the Trump Suit.` : `${seatName(room, idx)} chose ${suit} as the Trump Suit.`;
  room.message = `${autoText} ${room.bound ? 'Bound is active. ' : ''}${room.players[room.leader].name} starts.`;
  checkStartOfTrickPenalty(room);
  return true;
}

function chooseAutoCard(room, idx) {
  const hand = room.players[idx]?.hand || [];
  const sorted = [...hand].sort((a, b) => {
    const aJoker = isJoker(a);
    const bJoker = isJoker(b);
    if (aJoker || bJoker) {
      if (aJoker && bJoker) return (a.type === 'blackJoker' ? 100 : 101) - (b.type === 'blackJoker' ? 100 : 101);
      return aJoker ? 1 : -1;
    }
    const suitOrder = { hearts: 0, spades: 1, clubs: 2, diamonds: 3 };
    if (suitOrder[a.suit] !== suitOrder[b.suit]) return suitOrder[a.suit] - suitOrder[b.suit];
    return rankValue[a.rank] - rankValue[b.rank];
  });
  return sorted.find(card => {
    const valid = validPlay(room, idx, card);
    return valid.ok && !valid.illegalPenalty;
  }) || sorted.find(card => validPlay(room, idx, card).ok) || null;
}

function playCardFromHand(room, idx, cardId, automatic = false) {
  if (!room || room.phase !== 'playing') return { ok: false, msg: 'Not playing phase.' };
  const hand = room.players[idx]?.hand || [];
  const cardIndex = hand.findIndex(c => c.id === cardId);
  if (cardIndex < 0) return { ok: false, msg: 'Card not found.' };

  const valid = validPlay(room, idx, hand[cardIndex]);
  if (!valid.ok) return { ok: false, msg: valid.msg };

  const [card] = hand.splice(cardIndex, 1);

  if (valid.illegalPenalty) {
    illegalJokerPenalty(room, idx, valid.msg);
    return { ok: true };
  }

  if (card.type === 'blackJoker') room.blackJokerUsed = true;
  room.trick.push({ player: idx, card });

  if (room.trick.length === 4) {
    finishTrick(room);
  } else {
    room.turn = rightOf(idx);
    room.message = automatic
      ? `${seatName(room, idx)} timed out and auto-played ${card.label}. ${seatName(room, room.turn)}'s turn.`
      : `${seatName(room, idx)} played a card. ${seatName(room, room.turn)}'s turn.`;
  }

  return { ok: true };
}

io.on('connection', socket => {
  socket.on('createRoom', ({ name }) => {
    const room = makeRoom(socket.id, name || 'Host');
    socket.join(room.code);
    socket.emit('joined', { code: room.code });
    emitRoom(room);
  });

  socket.on('joinRoom', ({ code: roomCode, name, mode = 'player' }) => {
    const room = rooms.get((roomCode || '').toUpperCase());
    if (!room) return socket.emit('errorMessage', 'Room not found.');

    const displayName = name || (mode === 'spectator' ? 'Spectator' : `Player ${occupiedSeatCount(room) + 1}`);
    socket.join(room.code);

    if (mode === 'spectator') {
      room.spectators.push({ id: socket.id, name: displayName, connected: true });
      socket.emit('joined', { code: room.code });
      room.message = `${displayName} joined as a spectator.`;
      emitRoom(room);
      return;
    }

    const openIdx = room.players.findIndex(p => !isActiveSeat(p));
    if (openIdx === -1) {
      room.spectators.push({ id: socket.id, name: displayName, connected: true });
      socket.emit('joined', { code: room.code });
      room.message = `${displayName} joined as a spectator because all active seats are full.`;
      emitRoom(room);
      return;
    }

    room.players[openIdx] = { id: socket.id, name: displayName, connected: true, ready: false, hand: [], empty: false };
    socket.emit('joined', { code: room.code });
    if (occupiedSeatCount(room) === 4) room.message = 'Four players joined. Everyone must ready up before the host can start.';
    else room.message = `${displayName} joined Seat ${openIdx + 1}.`;
    emitRoom(room);
  });

  socket.on('toggleReady', ({ code: roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'lobby') return;
    const idx = room.players.findIndex(p => isActiveSeat(p) && p.id === socket.id);
    if (idx === -1) return;
    room.players[idx].ready = !room.players[idx].ready;
    const readyCount = room.players.filter(p => isActiveSeat(p) && p.ready && p.connected).length;
    room.message = `${room.players[idx].name} is ${room.players[idx].ready ? 'ready' : 'not ready'}. ${readyCount}/4 ready.`;
    emitRoom(room);
  });

  socket.on('startRound', ({ code: roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.hostId) return;
    if (occupiedSeatCount(room) !== 4) return socket.emit('errorMessage', 'Need exactly 4 active players.');
    if (!allActiveSeatsReady(room)) return socket.emit('errorMessage', 'All 4 active players must ready up before the game starts.');
    resetForNewRound(room);
    emitRoom(room);
  });

  socket.on('cutDeck', ({ code: roomCode, cutAt }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const idx = room.players.findIndex(p => isActiveSeat(p) && p.id === socket.id);
    if (room.phase !== 'cut' || idx !== room.cutter) return;
    const safeCut = Number.isInteger(cutAt) && cutAt > 0 && cutAt < 36 ? cutAt : Math.floor(Math.random() * 35) + 1;
    room.deck = [...room.deck.slice(safeCut), ...room.deck.slice(0, safeCut)];
    deal(room);
    emitRoom(room);
  });

  socket.on('bid', ({ code: roomCode, value }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const idx = room.players.findIndex(p => isActiveSeat(p) && p.id === socket.id);
    if (room.phase !== 'bidding' || idx !== room.biddingTurn) return;

    const minBid = getMinimumBid(room, idx);

    if (value === 'BOUND' || Number(value) === 9) {
      room.currentBid = 'BOUND';
      room.currentBidder = idx;
      finalizeBid(room, idx);
      emitRoom(room);
      return;
    }

    const bid = Number(value);
    if (!Number.isInteger(bid) || bid < minBid || bid > 8) {
      return socket.emit('errorMessage', `Your minimum bid is ${minBid}. Select Bound if you want to bid all 9 tricks.`);
    }
    if (room.currentBid !== null && room.currentBid !== 'BOUND' && bid <= room.currentBid) {
      return socket.emit('errorMessage', 'Bid must be higher than current bid.');
    }

    room.currentBid = bid;
    room.currentBidder = idx;
    room.skipped[idx] = false;
    room.biddingTurn = nextUnskippedBidder(room, idx);
    checkBiddingEnd(room);
    emitRoom(room);
  });

  socket.on('skipBid', ({ code: roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const idx = room.players.findIndex(p => isActiveSeat(p) && p.id === socket.id);
    if (room.phase !== 'bidding' || idx !== room.biddingTurn) return;

    room.skipped[idx] = true;
    room.message = `${seatName(room, idx)} skipped the bid.`;
    checkBiddingEnd(room);
    if (room.phase === 'bidding') {
      room.biddingTurn = nextUnskippedBidder(room, idx);
      if (room.biddingTurn !== null) room.message += ` ${seatName(room, room.biddingTurn)} is next.`;
    }
    emitRoom(room);
  });

  socket.on('chooseTrump', ({ code: roomCode, suit }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const idx = room.players.findIndex(p => isActiveSeat(p) && p.id === socket.id);
    if (room.phase !== 'chooseTrump' || idx !== room.bidWinner || !suits.includes(suit)) return;

    applyTrumpChoice(room, idx, suit, false);
    emitRoom(room);
  });

  socket.on('playCard', ({ code: roomCode, cardId }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const idx = room.players.findIndex(p => isActiveSeat(p) && p.id === socket.id);
    const result = playCardFromHand(room, idx, cardId, false);
    if (!result.ok) return socket.emit('errorMessage', result.msg);
    emitRoom(room);
  });

  socket.on('callBoundDuringPlay', ({ code: roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const idx = room.players.findIndex(p => isActiveSeat(p) && p.id === socket.id);
    if (room.phase !== 'playing' || idx !== room.bidWinner || room.bound || room.roundBid === 'BOUND') return;

    if (room.trickNumber > 7) return socket.emit('errorMessage', 'Bound can only be called before or during trick 7.');

    const bidderTeam = teamOf(room.bidWinner);
    const completedTricks = room.trickNumber - 1;
    if (room.tricksWon[bidderTeam] !== completedTricks) {
      return socket.emit('errorMessage', 'You can only call Bound if your team has won every completed trick so far.');
    }

    room.bound = true;
    room.message = `${room.players[idx].name} called Bound during play. They must win all 9 tricks or lose the game.`;
    emitRoom(room);
  });

  socket.on('sendChat', ({ code: roomCode, text }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const cleanText = String(text || '').trim().slice(0, 300);
    if (!cleanText) return;

    const spectator = (room.spectators || []).find(s => s.id === socket.id);
    if (!spectator) {
      return socket.emit('errorMessage', 'Chat is only available to spectators.');
    }

    room.chat = [...(room.chat || []), { senderName: spectator.name, role: 'spectator', text: cleanText, at: Date.now() }].slice(-50);
    emitRoom(room);
  });

  socket.on('kickUser', ({ code: roomCode, targetId }) => {
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.hostId || targetId === room.hostId) return;

    const activeIdx = room.players.findIndex(p => isActiveSeat(p) && p.id === targetId);
    const spectatorIdx = (room.spectators || []).findIndex(s => s.id === targetId);
    let targetName = 'User';

    if (activeIdx !== -1) {
      targetName = room.players[activeIdx].name;
      room.players[activeIdx] = emptySeat();
      if (room.phase !== 'lobby') {
        clearRoundStateToLobby(room, `${targetName} was kicked by the host. The current round was cancelled and the room returned to the lobby.`);
      } else {
        room.message = `${targetName} was kicked by the host.`;
      }
    } else if (spectatorIdx !== -1) {
      targetName = room.spectators[spectatorIdx].name;
      room.spectators.splice(spectatorIdx, 1);
      room.message = `${targetName} was kicked by the host.`;
    } else {
      return;
    }

    io.to(targetId).emit('kicked', 'You were removed from the room by the host.');
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) targetSocket.leave(room.code);
    emitRoom(room);
  });

  socket.on('moveToSpectator', ({ code: roomCode, targetId }) => {
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.hostId) return;

    const activeIdx = room.players.findIndex(p => isActiveSeat(p) && p.id === targetId);
    if (activeIdx === -1) return;

    const player = room.players[activeIdx];
    room.players[activeIdx] = emptySeat();
    room.spectators.push({ id: player.id, name: player.name, connected: player.connected });

    if (room.phase !== 'lobby') {
      clearRoundStateToLobby(room, `${player.name} was moved to spectators by the host. The current round was cancelled and the room returned to the lobby.`);
    } else {
      room.message = `${player.name} was moved to spectators. Seat ${activeIdx + 1} is now open.`;
    }
    emitRoom(room);
  });


  socket.on('leaveSeat', ({ code: roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'lobby') return;
    const idx = room.players.findIndex(p => isActiveSeat(p) && p.id === socket.id);
    if (idx === -1) return;
    const player = room.players[idx];
    room.players[idx] = emptySeat();
    room.spectators.push({ id: player.id, name: player.name, connected: player.connected });
    room.message = `${player.name} left Seat ${idx + 1} and joined spectators.`;
    emitRoom(room);
  });

  socket.on('joinSeat', ({ code: roomCode, seat }) => {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'lobby') return;
    const targetSeat = Number(seat);
    if (!Number.isInteger(targetSeat) || targetSeat < 0 || targetSeat > 3) return;
    if (isActiveSeat(room.players[targetSeat])) return socket.emit('errorMessage', 'That seat is already taken.');

    const currentSeat = room.players.findIndex(p => isActiveSeat(p) && p.id === socket.id);
    const spectatorIdx = (room.spectators || []).findIndex(s => s.id === socket.id);
    let joiningUser = null;

    if (currentSeat !== -1) {
      joiningUser = room.players[currentSeat];
      room.players[currentSeat] = emptySeat();
    } else if (spectatorIdx !== -1) {
      const spectator = room.spectators.splice(spectatorIdx, 1)[0];
      joiningUser = { id: spectator.id, name: spectator.name, connected: spectator.connected, ready: false, hand: [], empty: false };
    } else {
      return socket.emit('errorMessage', 'You are not in this room.');
    }

    joiningUser.ready = false;
    joiningUser.hand = [];
    joiningUser.empty = false;
    room.players[targetSeat] = joiningUser;
    room.message = `${joiningUser.name} joined Seat ${targetSeat + 1} (${teamLabel(teamOf(targetSeat))}).`;
    emitRoom(room);
  });

  socket.on('movePlayerToSeat', ({ code: roomCode, targetId, seat }) => {
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.hostId || room.phase !== 'lobby') return;
    const targetSeat = Number(seat);
    if (!Number.isInteger(targetSeat) || targetSeat < 0 || targetSeat > 3) return;

    const fromSeat = room.players.findIndex(p => isActiveSeat(p) && p.id === targetId);
    if (fromSeat === -1 || fromSeat === targetSeat) return;

    const moving = room.players[fromSeat];
    const destination = room.players[targetSeat];
    moving.ready = false;
    moving.hand = [];

    if (isActiveSeat(destination)) {
      destination.ready = false;
      destination.hand = [];
      room.players[fromSeat] = destination;
      room.players[targetSeat] = moving;
      room.message = `Host swapped ${moving.name} with ${destination.name}. Ready states were reset.`;
    } else {
      room.players[fromSeat] = emptySeat();
      room.players[targetSeat] = moving;
      room.message = `Host moved ${moving.name} to Seat ${targetSeat + 1} (${teamLabel(teamOf(targetSeat))}).`;
    }
    emitRoom(room);
  });

  socket.on('nextRound', ({ code: roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'roundover') return;
    const dealer = room.nextDealer ?? rightOf(room.bidWinner ?? 0);
    resetForNewRound(room, dealer);
    emitRoom(room);
  });

  function handleStartNewGame(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'gameover' || socket.id !== room.hostId) return;
    if (occupiedSeatCount(room) !== 4) return socket.emit('errorMessage', 'Need exactly 4 active players to start a new game.');
    resetMatchForReplay(room);
    emitRoom(room);
  }

  socket.on('playAgain', ({ code: roomCode }) => handleStartNewGame(roomCode));
  socket.on('startNewGame', ({ code: roomCode }) => handleStartNewGame(roomCode));

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      const p = room.players.find(p => isActiveSeat(p) && p.id === socket.id);
      const s = (room.spectators || []).find(s => s.id === socket.id);
      if (p) { p.connected = false; p.ready = false; }
      if (s) s.connected = false;
      if (p || s) emitRoom(room);
    }
  });
});

const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));

server.listen(PORT, () => console.log(`Server running on ${PORT}`));
