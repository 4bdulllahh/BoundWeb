import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import {
  CheckCircle,
  Clock,
  Copy,
  Crown,
  Eye,
  HelpCircle,
  MessageCircle,
  RotateCcw,
  Shield,
  Sparkles,
  Swords,
  Trophy,
  Users,
  X
} from 'lucide-react';
import './styles.css';

const socket = io(import.meta.env.PROD ? undefined : 'http://localhost:3001');

const suitSymbols = { hearts: '♥', spades: '♠', clubs: '♣', diamonds: '♦' };
const suitNames = { hearts: 'Hearts', spades: 'Spades', clubs: 'Clubs', diamonds: 'Diamonds' };
const suitOrder = { hearts: 0, spades: 1, clubs: 2, diamonds: 3 };
const rankOrder = { '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };
const teamName = team => team === 0 ? 'Team A' : 'Team B';
const isOccupiedPlayer = p => Boolean(p && !p.empty);

function App() {
  const [state, setState] = useState(null);
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');

  React.useEffect(() => {
    socket.on('state', setState);
    socket.on('joined', ({ code }) => setRoomCode(code));
    socket.on('errorMessage', msg => {
      setError(msg);
      setTimeout(() => setError(''), 3600);
    });
    socket.on('kicked', msg => {
      setState(null);
      setError(msg);
    });
    return () => {
      socket.off('state');
      socket.off('joined');
      socket.off('errorMessage');
      socket.off('kicked');
    };
  }, []);

  if (!state) {
    return <Landing name={name} setName={setName} roomCode={roomCode} setRoomCode={setRoomCode} error={error} />;
  }

  return <Game state={state} error={error} />;
}

function Landing({ name, setName, roomCode, setRoomCode, error }) {
  const [showRules, setShowRules] = useState(false);
  const create = () => socket.emit('createRoom', { name: name.trim() || 'Player' });
  const join = () => socket.emit('joinRoom', { code: roomCode.trim().toUpperCase(), name: name.trim() || 'Player', mode: 'player' });
  const spectate = () => socket.emit('joinRoom', { code: roomCode.trim().toUpperCase(), name: name.trim() || 'Spectator', mode: 'spectator' });

  return (
    <main className="landing landingSimple">
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      <section className="hero cardPanel landingMenuPanel">
        <div className="brand"><Swords /> Bound</div>
        <h1>A live team card game for four players.</h1>
        <p>Bid, choose Trump Suit, defend with Jokers, call Bound, and race to 54 points.</p>
        <button className="secondary howButton" onClick={() => setShowRules(true)}><HelpCircle size={17}/> Rules / How to Play</button>
        <div className="formGrid">
          <input placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
          <button onClick={create}>Create Room</button>
        </div>
        <div className="divider">or join an existing table</div>
        <div className="formGrid joinGrid">
          <input placeholder="Room code" value={roomCode} onChange={e => setRoomCode(e.target.value)} />
          <button onClick={join}>Join as Player</button>
          <button className="secondary" onClick={spectate}><Eye size={16}/> Spectate</button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}

function HowToPlayContent({ compact = false }) {
  const items = [
    ['Teams', 'Four players sit around the table. Opposite seats are teammates: Team A is top/bottom and Team B is left/right.'],
    ['Bidding', 'Players bid how many tricks their team will win. Normal minimum is 6. A bid of 5 only appears when the first three players skip.'],
    ['Trump Suit', 'The highest bidder chooses the Trump Suit after winning the auction. Trump cards beat normal lead-suit cards.'],
    ['Tricks', 'Follow the lead suit if you have it. If you cannot, you may play Trump, a filler card, or a valid Joker.'],
    ['Jokers', 'Jokers cannot start a trick. Black Joker must be used within the first 3 tricks. Red Joker beats Black but cannot be held into the last trick.'],
    ['Bound', 'Bound means your team promises all 9 tricks. Success wins the match immediately. Failure loses the match immediately.'],
    ['Scoring', 'Reach 54 points to win. Smart early termination ends the round as soon as the bid is made or becomes impossible.'],
    ['No History', 'Played-card history is hidden. Counting cards manually is part of the game skill.']
  ];

  return <div className={compact ? 'howList compact' : 'howList'}>{items.map(([title, text]) => <RuleBlock key={title} title={title} text={text} />)}</div>;
}

function Game({ state, error }) {
  const [showRules, setShowRules] = useState(false);
  const isSpectator = state.meRole === 'spectator';
  const isHost = state.meIsHost;
  const me = state.meSeat !== null ? state.players[state.meSeat] : null;
  const isMyTurn = !isSpectator && state.turn === state.meSeat;
  const myBidTurn = !isSpectator && state.biddingTurn === state.meSeat;
  const canCut = !isSpectator && state.phase === 'cut' && state.cutter === state.meSeat;
  const canChooseTrump = !isSpectator && state.phase === 'chooseTrump' && state.bidWinner === state.meSeat;
  const canCallBound = !isSpectator && state.phase === 'playing' && state.bidWinner === state.meSeat && !state.bound && state.roundBid !== 'BOUND' && state.trickNumber <= 7;
  const sortedHand = useMemo(() => sortHand(state.hand || []), [state.hand]);

  return (
    <main className="app">
      <header className="topbar cardPanel">
        <div className="topbarLeft">
          <div className="brand"><Swords /> Bound</div>
          <p className="muted roomLine">
            Room <b>{state.code}</b>
            <button className="mini" onClick={() => navigator.clipboard.writeText(state.code)}><Copy size={14}/> Copy</button>
            {isSpectator && <span className="spectatorPill"><Eye size={13}/> Spectator</span>}
          </p>
        </div>
        <Scoreboard scores={state.scores} />
        <button className="rulesButton" onClick={() => setShowRules(true)}><HelpCircle size={17}/> Rules</button>
      </header>

      {error && <div className="toast">{error}</div>}
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}

      <section className="mainGrid">
        <aside className="leftRail cardPanel">
          <SectionTitle icon={<Users size={18}/>} title="Teams & Players" />
          <TeamPanels state={state} />
          <GameStatusPanel state={state} isMyTurn={isMyTurn} myBidTurn={myBidTurn} canChooseTrump={canChooseTrump} canCut={canCut} />
        </aside>

        <section className="tableColumn noVitalsColumn">
          <div className={`tableStage cardPanel ${state.phase === 'lobby' ? 'lobbyStage' : ''} ${state.phase === 'lobby' && isHost ? 'hostLobbyStage' : ''} ${state.phase === 'gameover' ? 'gameoverStage' : ''}`}>
            <SeatedTable state={state} />
            <div className={`centerFelt cleanCenter ${state.phase === 'gameover' ? 'gameOverCenter' : ''} ${state.phase === 'chooseTrump' ? 'trumpCenter' : ''}`}>
              {state.phase === 'lobby' && <LobbyActions state={state} isHost={isHost} isSpectator={isSpectator} me={me} />}
              {state.phase === 'cut' && <ActionButton disabled={!canCut} onClick={() => socket.emit('cutDeck', { code: state.code })}>{canCut ? 'Cut Deck' : 'Waiting for cutter'}</ActionButton>}
              {state.phase === 'bidding' && <Bidding state={state} enabled={myBidTurn} />}
              {state.phase === 'chooseTrump' && <TrumpPicker state={state} enabled={canChooseTrump} />}
              {(state.phase === 'playing' || state.phase === 'roundover' || state.phase === 'gameover') && <Board state={state} />}
              {state.phase === 'roundover' && <ActionButton onClick={() => socket.emit('nextRound', { code: state.code })}><RotateCcw size={16}/> Start Next Round</ActionButton>}
              {state.phase === 'gameover' && <GameOver state={state} isHost={isHost} />}
            </div>
          </div>
        

          {!isSpectator && sortedHand.length > 0 && (
            <section className="handDock cardPanel cardsOnlyHand">
              <div className="cards">
                {sortedHand.map(card => {
                  const meta = getCardPlayMeta(card, state, sortedHand, isMyTurn);
                  return <Card key={card.id} card={card} meta={meta} onClick={() => socket.emit('playCard', { code: state.code, cardId: card.id })} />;
                })}
              </div>
            </section>
          )}
        </section>

        <aside className="rightRail cardPanel">
          <SectionTitle icon={<Shield size={18}/>} title="Round Info" />
          <Info state={state} />
          <BoundAction state={state} canCallBound={canCallBound} />
          <SpectatorList state={state} isHost={isHost} />
          {isSpectator && <Chat state={state} />}
        </aside>
      </section>
    </main>
  );
}

function SectionTitle({ icon, title }) {
  return <h2 className="sectionTitle">{icon}{title}</h2>;
}

function Scoreboard({ scores }) {
  const leader = scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1;
  return (
    <div className="scoreboard" aria-label="Scoreboard">
      {[0, 1].map(team => (
        <div key={team} className={`scoreCard team${team + 1} ${leader === team ? 'leading' : ''}`}>
          <span>{teamName(team)}</span>
          <b>{scores[team]}</b>
          <small>{leader === team ? 'Leading' : 'Target 54'}</small>
        </div>
      ))}
    </div>
  );
}

function TeamPanels({ state }) {
  return (
    <div className="teamPanels">
      {[0, 1].map(team => (
        <div className={`teamPanel team${team + 1}`} key={team}>
          <div className="teamTitle"><Crown size={15}/> {teamName(team)}</div>
          {state.players.filter(p => p.team === team).map(p => <PlayerRow key={p.seat} p={p} state={state} />)}
        </div>
      ))}
    </div>
  );
}

function PlayerRow({ p, state }) {
  const occupied = isOccupiedPlayer(p);
  const badges = occupied ? playerBadges(p, state) : [];
  const isMe = occupied && state.meSeat === p.seat;
  const isActive = occupied && (state.turn === p.seat || state.biddingTurn === p.seat || state.cutter === p.seat || state.bidWinner === p.seat);
  return (
    <div className={`playerRow ${isMe ? 'self' : ''} ${isActive ? 'active' : ''} ${occupied && !p.connected ? 'offline' : ''} ${!occupied ? 'openRow' : ''}`}>
      <div>
        <b>{occupied ? p.name : 'Open seat'}</b>
        <span>Seat {p.seat + 1}{isMe ? ' · You' : ''}</span>
      </div>
      <div className="badges">{occupied ? badges.map(b => <em key={b}>{b}</em>) : <em>Open</em>}</div>
    </div>
  );
}

function playerBadges(p, state) {
  if (!isOccupiedPlayer(p)) return [];
  const badges = [];
  if (state.dealer === p.seat) badges.push('Shuffler');
  if (state.cutter === p.seat) badges.push('Cutter');
  if (state.biddingTurn === p.seat) badges.push('Bid turn');
  if (state.bidWinner === p.seat) badges.push('Bid winner');
  if (state.turn === p.seat) badges.push('Play turn');
  if (p.ready && state.phase === 'lobby') badges.push('Ready');
  return badges;
}

function SpectatorList({ state, isHost }) {
  const spectators = state.spectators || [];

  return (
    <div className="spectators">
      <h3><Eye size={15}/> Spectators</h3>
      {!spectators.length && <p className="muted smallText">No spectators yet.</p>}
      {spectators.map((s, i) => (
        <div className={`spectator ${!s.connected ? 'offline' : ''}`} key={`${s.name}-${i}`}>
          <span>{s.name}</span>
          {isHost && s.id && <button className="mini dangerMini" onClick={() => socket.emit('kickUser', { code: state.code, targetId: s.id })}>Kick</button>}
        </div>
      ))}
    </div>
  );
}

function HostControlsHint({ isHost }) {
  if (!isHost) return null;
  return <p className="hostHint">Host controls are available on the seat cards around the table.</p>;
}

function GameStatusPanel({ state, isMyTurn, myBidTurn, canChooseTrump, canCut }) {
  return (
    <div className="sideStatusPanel">
      <p className="phaseLabel">{phaseTitle(state)}</p>
      <h3>{importantStatus(state, isMyTurn, myBidTurn, canChooseTrump, canCut)}</h3>
      <p>{state.message}</p>
      <Countdown state={state} />
    </div>
  );
}

function Countdown({ state }) {
  const [now, setNow] = useState(Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  if (!state.timer?.deadline) return null;
  const remaining = Math.max(0, Math.ceil((state.timer.deadline - now) / 1000));
  const urgent = remaining <= 5;
  return (
    <div className={`timerBadge ${urgent ? 'urgent' : ''}`}>
      <Clock size={16}/>
      <span>{remaining}s</span>
      <small>Turn timer</small>
    </div>
  );
}


function RoundVitals({ state, isMyTurn, myBidTurn }) {
  const bidText = displayBid(state.roundBid || state.currentBid || 'None');
  const bidder = state.bidWinner !== null ? state.players[state.bidWinner]?.name : state.currentBidder !== null ? state.players[state.currentBidder]?.name : null;
  const turnName = state.turn !== null ? state.players[state.turn]?.name : state.biddingTurn !== null ? state.players[state.biddingTurn]?.name : null;

  return (
    <div className="vitals cardPanel">
      <div className="vitalItem turnVital">
        <span>{isMyTurn ? 'Your turn' : myBidTurn ? 'Your bid' : 'Current turn'}</span>
        <b>{isMyTurn || myBidTurn ? 'You' : turnName || 'Waiting'}</b>
      </div>
      <div className="vitalItem">
        <span>Bid</span>
        <b>{bidText}{bidder ? <small> by {bidder}</small> : null}</b>
      </div>
      <div className="vitalItem trumpVital">
        <span>Trump Suit</span>
        <b>{state.trump ? `${suitSymbols[state.trump]} ${suitNames[state.trump]}` : 'Not chosen'}</b>
      </div>
      <div className="vitalItem">
        <span>Tricks</span>
        <b className="trickScoreLine"><span>Team A: {state.tricksWon[0]}</span><span>Team B: {state.tricksWon[1]}</span></b>
      </div>
      <div className="vitalItem">
        <span>Round</span>
        <b>{state.trickNumber || 0}/9 {state.bound ? <small className="boundText">Bound active</small> : null}</b>
      </div>
    </div>
  );
}

function SeatedTable({ state }) {
  const positions = getSeatPositions(state);
  return (
    <div className="seatLayer" aria-label="Table seats">
      {positions.map(({ seat, pos }) => (
        <SeatCard key={`${seat}-${pos}`} seat={seat} pos={pos} state={state} />
      ))}
    </div>
  );
}

function getSeatPositions() {
  // Fixed table layout: Team A sits top/bottom, Team B sits left/right.
  // This mirrors the real table instead of rotating differently for each player.
  return [
    { seat: 0, pos: 'top' },
    { seat: 1, pos: 'left' },
    { seat: 2, pos: 'bottom' },
    { seat: 3, pos: 'right' }
  ];
}

function SeatCard({ seat, pos, state }) {
  const p = state.players[seat];
  const occupied = isOccupiedPlayer(p);
  const isHost = state.meIsHost;
  const isMe = occupied && state.meSeat === seat;
  const isTeammate = occupied && state.meSeat !== null && p?.team === state.players[state.meSeat]?.team && !isMe;
  const badges = occupied ? playerBadges(p, state) : [];
  const isActive = occupied && (state.turn === seat || state.biddingTurn === seat || state.cutter === seat);
  const canChangeSeats = state.phase === 'lobby';
  const canJoinThisSeat = canChangeSeats && !occupied;

  return (
    <div className={`seatCard seat-${pos} team${occupied ? p.team + 1 : 'Open'} ${isMe ? 'self' : ''} ${isTeammate ? 'teammate' : ''} ${isActive ? 'activeTurn' : ''} ${occupied && !p.connected ? 'offline' : ''}`}>
      {occupied ? (
        <>
          <div className="seatMeta">
            <span>Seat {seat + 1}</span>
            <b>{p.name}</b>
            <small>{isMe ? 'You' : isTeammate ? 'Your teammate' : teamName(p.team)}</small>
          </div>
          <div className="badges">{badges.map(b => <em key={b}>{b}</em>)}</div>
          {canChangeSeats && isMe && <div className="adminControls">
            <button className="mini" onClick={() => socket.emit('leaveSeat', { code: state.code })}>Leave Seat</button>
          </div>}
          {isHost && p.id && canChangeSeats && <div className="adminControls hostSeatControls">
            {p.id !== socket.id && <button className="mini dangerMini" onClick={() => socket.emit('kickUser', { code: state.code, targetId: p.id })}>Kick</button>}
            <button className="mini" onClick={() => socket.emit('moveToSpectator', { code: state.code, targetId: p.id })}>Spectate</button>
            <select className="miniSelect" defaultValue="" onChange={e => { if (e.target.value !== '') socket.emit('movePlayerToSeat', { code: state.code, targetId: p.id, seat: Number(e.target.value) }); e.target.value = ''; }}>
              <option value="">Move seat</option>
              {state.players.map(target => target.seat).filter(targetSeat => targetSeat !== seat).map(targetSeat => (
                <option key={targetSeat} value={targetSeat}>Seat {targetSeat + 1} · {teamName(state.players[targetSeat]?.team)}</option>
              ))}
            </select>
          </div>}
        </>
      ) : (
        <div className="seatMeta emptySeat">
          <span>Seat {seat + 1}</span>
          <b>Open seat</b>
          <small>{teamName(p?.team ?? seat % 2)}</small>
          {canJoinThisSeat && <button className="mini joinSeatButton" onClick={() => socket.emit('joinSeat', { code: state.code, seat })}>Join Seat</button>}
        </div>
      )}
    </div>
  );
}

function Info({ state }) {
  const bidderName = state.bidWinner !== null ? state.players[state.bidWinner]?.name : state.currentBidder !== null ? state.players[state.currentBidder]?.name : '';
  const biddingTeam = state.bidWinner !== null ? state.players[state.bidWinner]?.team : state.currentBidder !== null ? state.players[state.currentBidder]?.team : null;
  const target = state.roundBid === 'BOUND' ? 9 : Number(state.roundBid || state.currentBid || 0);
  const bidProgress = biddingTeam !== null && target ? `${state.tricksWon[biddingTeam]} / ${target}` : 'Not active';

  return (
    <div className="infoCards">
      <InfoCard label="Contract" value={`${displayBid(state.roundBid || state.currentBid || 'None')}${bidderName ? ` · ${bidderName}` : ''}`} />
      <InfoCard label="Bidding team progress" value={bidProgress} />
      <InfoCard label="Trump Suit" value={state.trump ? `${suitSymbols[state.trump]} ${suitNames[state.trump]}` : 'Not chosen'} />
      <InfoCard label="Current trick" value={`${state.trickNumber || 0} / 9`} />
      <InfoCard label="Bound" value={state.bound ? 'Active' : 'Not active'} highlight={state.bound} />
    </div>
  );
}

function InfoCard({ label, value, highlight }) {
  return <div className={`infoCard ${highlight ? 'highlight' : ''}`}><span>{label}</span><b>{value}</b></div>;
}

function BoundAction({ state, canCallBound }) {
  return (
    <div className="boundSideBox">
      <div>
        <span>Bound action</span>
        <b>{state.bound ? 'Bound is active' : canCallBound ? 'Available now' : 'Not available'}</b>
      </div>
      {canCallBound && (
        <button className="danger boundPulse" onClick={() => socket.emit('callBoundDuringPlay', { code: state.code })}>
          <Sparkles size={17}/> Call Bound
        </button>
      )}
    </div>
  );
}


function MemoryMode() {
  return (
    <div className="memoryBox">
      <h2><Shield size={18}/> Memory Mode</h2>
      <p>Played-card history is intentionally hidden. Only the live table pile is visible, so counting cards stays part of the game.</p>
    </div>
  );
}

function LobbyActions({ state, isHost, isSpectator, me }) {
  const activePlayers = state.players.filter(isOccupiedPlayer);
  const readyCount = activePlayers.filter(p => p.ready && p.connected).length;
  const allReady = activePlayers.length === 4 && activePlayers.every(p => p.ready && p.connected);
  const myReady = Boolean(me?.ready);

  return (
    <div className="centerBox lobbyReadyBox">
      <h3>Ready Up</h3>
      <p>{activePlayers.length}/4 active players joined · {readyCount}/4 ready.</p>
      <div className="readyGrid">
        {state.players.map(p => (
          <div key={p.seat} className={`readyChip ${p.ready ? 'ready' : ''} ${p.empty ? 'open' : ''}`}>
            {p.empty ? <Users size={15}/> : p.ready ? <CheckCircle size={15}/> : <Clock size={15}/>} {p.empty ? `Seat ${p.seat + 1} open` : p.name}
          </div>
        ))}
      </div>
      {!isSpectator && me && (
        <button className={`readyButton ${myReady ? 'ready' : ''}`} onClick={() => socket.emit('toggleReady', { code: state.code })}>
          {myReady ? <><CheckCircle size={16}/> Ready</> : <><Clock size={16}/> Ready Up</>}
        </button>
      )}
      {isHost && (
        <ActionButton disabled={!allReady} onClick={() => socket.emit('startRound', { code: state.code })}>
          Start Game
        </ActionButton>
      )}
      {!isHost && <p className="muted">Waiting for the host to start once everyone is ready.</p>}
      {isHost && !allReady && <p className="muted">All 4 active players must join seats and ready up first.</p>}
    </div>
  );
}

function Bidding({ state, enabled }) {
  const minBid = getMinBid(state);
  const options = getBidOptions(minBid);
  const [bid, setBid] = useState(options[0]?.value ?? 6);

  React.useEffect(() => {
    setBid(options[0]?.value ?? 6);
  }, [minBid, state.currentBid, state.skipped?.join('-')]);

  return (
    <div className="bidBox">
      <div className="auctionSummary">
        <div><span>Highest bid</span><b>{state.currentBid ? displayBid(state.currentBid) : 'None'}</b></div>
        <div><span>Highest bidder</span><b>{state.currentBidder !== null ? state.players[state.currentBidder]?.name : 'None'}</b></div>
        <div><span>Minimum now</span><b>{enabled ? displayBid(minBid) : '—'}</b></div>
      </div>

      <div className="skipTrack">
        {state.players.map(p => <span key={p.seat} className={state.skipped?.[p.seat] ? 'skipped' : state.biddingTurn === p.seat ? 'current' : ''}>{p.name}: {state.skipped?.[p.seat] ? 'Skip' : state.biddingTurn === p.seat ? 'Turn' : 'Waiting'}</span>)}
      </div>

      <p>{enabled ? `Your bidding turn. Choose ${minBid === 5 ? '5, 6, 7, 8, or Bound' : '6, 7, 8, or Bound'}.` : `Waiting for ${state.players[state.biddingTurn]?.name} to bid or skip.`}</p>
      <div className="bidControls">
        <select disabled={!enabled} value={String(bid)} onChange={e => setBid(e.target.value === 'BOUND' ? 'BOUND' : Number(e.target.value))}>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button disabled={!enabled} onClick={() => socket.emit('bid', { code: state.code, value: bid })}>Bid</button>
        <button className="secondary" disabled={!enabled} onClick={() => socket.emit('skipBid', { code: state.code })}>Skip</button>
      </div>
    </div>
  );
}

function getBidOptions(minBid) {
  const options = [];
  for (let n = minBid; n <= 8; n++) options.push({ value: n, label: String(n) });
  options.push({ value: 'BOUND', label: 'Bound' });
  return options;
}

function displayBid(value) {
  if (value === 'BOUND') return 'Bound';
  if (value === null || value === undefined || value === '') return 'None';
  return value;
}

function getMinBid(state) {
  if (state.currentBid && state.currentBid !== 'BOUND') return state.currentBid + 1;
  const skipped = state.skipped?.filter(Boolean).length || 0;
  if (!state.currentBid && skipped === 3) return 5;
  return 6;
}

function TrumpPicker({ state, enabled }) {
  return (
    <div className="trumpPanel">
      <p>{enabled ? 'Choose the Trump Suit for this round.' : `Waiting for ${state.players[state.bidWinner]?.name} to choose Trump Suit.`}</p>
      <div className="suitPicker">
        {Object.keys(suitSymbols).map(s => (
          <button key={s} className={`suitButton ${s}`} disabled={!enabled} onClick={() => socket.emit('chooseTrump', { code: state.code, suit: s })}>
            <span>{suitSymbols[s]}</span>
            <b>{suitNames[s]}</b>
          </button>
        ))}
      </div>
    </div>
  );
}

function Board({ state }) {
  const positions = getSeatPositions();
  const positionBySeat = Object.fromEntries(positions.map(({ seat, pos }) => [seat, pos]));
  const playsByPos = Object.fromEntries((state.trick || []).map(play => [positionBySeat[play.player], play]));
  const hasCards = (state.trick || []).length > 0;

  return (
    <div className="board tableOnlyBoard">
      <div className="trickTable" aria-label="Current trick table">
        {!hasCards && <p className="muted emptyTrick">No cards on the table yet.</p>}
        {['top', 'left', 'right', 'bottom'].map(pos => {
          const play = playsByPos[pos];
          return (
            <div key={pos} className={`trickSlot trick-${pos} ${play ? 'hasCard' : ''}`}>
              {play ? (
                <>
                  <span>{state.players[play.player]?.name}</span>
                  <Card card={play.card} table />
                </>
              ) : <div className="slotGhost" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Card({ card, meta = { playable: true }, onClick, small = false, table = false }) {
  const red = card.suit === 'hearts' || card.suit === 'diamonds' || card.type === 'redJoker';
  const joker = card.type !== 'normal';
  const disabled = small || table ? true : !meta.playable;
  const title = meta.reason || card.label || '';

  return (
    <button
      className={`playingCard ${red ? 'red' : ''} ${joker ? 'joker' : ''} ${small ? 'small' : ''} ${table ? 'tableCard' : ''} ${meta.playable || table ? 'playable' : 'notPlayable'} ${meta.risky ? 'risky' : ''}`}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {joker ? (
        <>
          <span className="jokerCorner top">{card.type === 'redJoker' ? 'RJ' : 'BJ'}</span>
          <span className="jokerIcon" aria-hidden="true">🃏</span>
          <span className="jokerCorner bottom">{card.type === 'redJoker' ? 'RJ' : 'BJ'}</span>
        </>
      ) : (
        <>
          <span className="cardCorner top"><b>{card.rank}</b><em aria-hidden="true">{suitSymbols[card.suit]}</em></span>
          <span className="cardSuit" aria-hidden="true">{suitSymbols[card.suit]}</span>
          <span className="cardCorner bottom"><b>{card.rank}</b><em aria-hidden="true">{suitSymbols[card.suit]}</em></span>
        </>
      )}
    </button>
  );
}

function GameOver({ state, isHost }) {
  const winnerLabel = state.gameWinnerTeam !== null && state.gameWinnerTeam !== undefined
    ? `${teamName(state.gameWinnerTeam)} Wins!`
    : 'Game Over';

  return (
    <div className="gameOverModal">
      <div className="gameOverInner">
        <Trophy />
        <h2>{winnerLabel}</h2>
        {state.endedByBound && <p className="boundBanner">Game ended by Bound</p>}
        <p>{state.message}</p>
        <p className="finalScore">Final Score: <b>Team A: {state.scores[0]}</b> · <b>Team B: {state.scores[1]}</b></p>
        {isHost ? (
          <ActionButton onClick={() => socket.emit('startNewGame', { code: state.code })}>
            <RotateCcw size={16}/> Start New Game
          </ActionButton>
        ) : (
          <p className="muted">Waiting for the host to start a new game.</p>
        )}
      </div>
    </div>
  );
}

function Chat({ state }) {
  const [text, setText] = useState('');
  const send = () => {
    const clean = text.trim();
    if (!clean) return;
    socket.emit('sendChat', { code: state.code, text: clean });
    setText('');
  };

  return (
    <div className="chatBox">
      <hr />
      <h2><MessageCircle size={18}/> Chat</h2>
      <div className="chatLog">
        {(state.chat || []).length === 0 && <p className="muted">No messages yet.</p>}
        {(state.chat || []).map((m, i) => <p key={`${m.at}-${i}`}><b>{m.senderName}</b> <span className="muted">({m.role})</span>: {m.text}</p>)}
      </div>
      <div className="chatInput">
        <input placeholder="Message" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} />
        <button className="mini" onClick={send}>Send</button>
      </div>
    </div>
  );
}

function RulesModal({ onClose }) {
  return (
    <div className="modalBackdrop" onClick={onClose}>
      <div className="rulesModal cardPanel" onClick={e => e.stopPropagation()}>
        <div className="modalHeader">
          <h2><HelpCircle size={20}/> Bound Rules</h2>
          <button className="mini closeButton" onClick={onClose} aria-label="Close rules"><X size={18}/></button>
        </div>
        <HowToPlayContent />
      </div>
    </div>
  );
}

function RuleBlock({ title, text }) {
  return <div className="ruleBlock"><b>{title}</b><p>{text}</p></div>;
}

function ActionButton({ children, ...props }) {
  return <button className="action" {...props}>{children}</button>;
}

function phaseTitle(state) {
  return ({
    lobby: 'Lobby',
    cut: 'Cut the Deck',
    bidding: 'Bidding Phase',
    chooseTrump: 'Choose Trump Suit',
    playing: 'Round in Progress',
    roundover: 'Round Over',
    gameover: 'Game Over'
  })[state.phase] || state.phase;
}

function importantStatus(state, isMyTurn, myBidTurn, canChooseTrump, canCut) {
  if (state.phase === 'gameover') return 'Match finished';
  if (canCut) return 'You must cut the deck';
  if (myBidTurn) return 'Your bid';
  if (canChooseTrump) return 'Choose Trump Suit';
  if (isMyTurn) return 'Your turn to play';
  if (state.phase === 'playing' && state.turn !== null) return `${state.players[state.turn]?.name} is playing`;
  if (state.phase === 'bidding' && state.biddingTurn !== null) return `${state.players[state.biddingTurn]?.name} is bidding`;
  return phaseTitle(state);
}

function sortHand(hand) {
  const jokerOrder = { blackJoker: 100, redJoker: 101 };
  return [...hand].sort((a, b) => {
    const aJoker = a.type !== 'normal';
    const bJoker = b.type !== 'normal';
    if (aJoker || bJoker) {
      if (aJoker && bJoker) return jokerOrder[a.type] - jokerOrder[b.type];
      return aJoker ? 1 : -1;
    }
    if (suitOrder[a.suit] !== suitOrder[b.suit]) return suitOrder[a.suit] - suitOrder[b.suit];
    return rankOrder[a.rank] - rankOrder[b.rank];
  });
}

function getCardPlayMeta(card, state, hand, isMyTurn) {
  if (state.phase !== 'playing' || !isMyTurn) return { playable: false, reason: 'Not your turn.' };

  const isLead = state.trick.length === 0;
  const isJokerCard = card.type !== 'normal';

  if (isLead && isJokerCard) return { playable: false, reason: 'Jokers cannot start a trick.' };

  if (card.type === 'redJoker') {
    const hasBoth = hand.some(c => c.type === 'blackJoker') && hand.some(c => c.type === 'redJoker');
    if (!state.blackJokerUsed && !hasBoth) return { playable: false, reason: 'Red Joker can only be played after Black Joker, unless you hold both Jokers.' };
    if (state.trickNumber === 9) return { playable: false, reason: 'Red Joker cannot be played in the last trick.' };
  }

  if (card.type === 'blackJoker' && state.trickNumber > 3) {
    return { playable: true, risky: true, reason: 'This causes the 15-point Black Joker penalty.' };
  }

  const numericBid = Number(state.roundBid);
  if (isLead && Number.isInteger(numericBid) && numericBid >= 8 && state.trickNumber === 1) {
    const hasTrump = hand.some(c => c.type === 'normal' && c.suit === state.trump);
    if (hasTrump && !(card.type === 'normal' && card.suit === state.trump)) {
      return { playable: false, reason: 'Bid is 8 or more: first leader must start with Trump Suit if they have it.' };
    }
  }

  if (!isLead && card.type === 'normal') {
    const leadSuit = state.trick.find(play => play.card.type === 'normal')?.card.suit;
    const hasLeadSuit = hand.some(c => c.type === 'normal' && c.suit === leadSuit);
    if (leadSuit && hasLeadSuit && card.suit !== leadSuit) {
      return { playable: false, reason: `You must play ${suitNames[leadSuit]} if you have it.` };
    }
  }

  return { playable: true };
}

createRoot(document.getElementById('root')).render(<App />);
