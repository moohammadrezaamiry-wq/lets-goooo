const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// ========== لیدربورد (ذخیره در فایل JSON) ==========
const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json');

function loadLeaderboard() {
  try {
    if (fs.existsSync(LEADERBOARD_FILE)) {
      const data = fs.readFileSync(LEADERBOARD_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('خطا در خواندن لیدربورد:', e);
  }
  return {};
}

function saveLeaderboard(data) {
  try {
    fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('خطا در ذخیره لیدربورد:', e);
  }
}

let leaderboard = loadLeaderboard();

// ========== صف انتظار و مسابقات ==========
let waitingPlayers = [];
const matches = {};

// ========== Express ==========
app.use(express.static('public'));

// ========== Socket.io ==========
io.on('connection', (socket) => {
  console.log('🔵 کاربر متصل:', socket.id);
  let currentMatchId = null;

  socket.on('joinQueue', (username) => {
    socket.username = username || 'ناشناس';

    if (waitingPlayers.length > 0) {
      const opponentSocket = waitingPlayers.shift();
      const matchId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

      socket.join(matchId);
      opponentSocket.join(matchId);

      const matchData = {
        players: [socket.id, opponentSocket.id],
        usernames: [socket.username, opponentSocket.username],
        clicks: { [socket.id]: 0, [opponentSocket.id]: 0 },
        startTime: Date.now(),
        duration: 60,
        winner: null,
        finished: false,
        timerInterval: null
      };
      matches[matchId] = matchData;
      currentMatchId = matchId;

      io.to(matchId).emit('matchStart', {
        matchId,
        players: [
          { id: socket.id, username: socket.username },
          { id: opponentSocket.id, username: opponentSocket.username }
        ],
        duration: matchData.duration
      });

      let remaining = matchData.duration;
      matchData.timerInterval = setInterval(() => {
        remaining--;
        io.to(matchId).emit('timerUpdate', { remaining });
        if (remaining <= 0) {
          clearInterval(matchData.timerInterval);
          matchData.finished = true;
          const clicks = matchData.clicks;
          let winnerId = null;
          if (clicks[socket.id] > clicks[opponentSocket.id]) winnerId = socket.id;
          else if (clicks[opponentSocket.id] > clicks[socket.id]) winnerId = opponentSocket.id;

          matchData.winner = winnerId;
          io.to(matchId).emit('matchEnd', {
            winner: winnerId,
            usernames: matchData.usernames,
            finalClicks: clicks
          });

          updateLeaderboardAfterMatch(matchId);

          setTimeout(() => {
            delete matches[matchId];
          }, 5000);
        }
      }, 1000);

    } else {
      waitingPlayers.push(socket);
      socket.emit('waiting', { message: 'در انتظار حریف...' });
    }
  });

  socket.on('click', (matchId) => {
    const match = matches[matchId];
    if (!match || match.finished) return;
    if (!match.players.includes(socket.id)) return;

    match.clicks[socket.id] = (match.clicks[socket.id] || 0) + 1;
    io.to(matchId).emit('clickUpdate', {
      playerId: socket.id,
      clicks: match.clicks[socket.id],
      total: match.clicks
    });
  });

  socket.on('disconnect', () => {
    console.log('🔴 کاربر قطع شد:', socket.id);
    waitingPlayers = waitingPlayers.filter(s => s.id !== socket.id);

    for (const [matchId, match] of Object.entries(matches)) {
      if (match.players.includes(socket.id) && !match.finished) {
        match.finished = true;
        if (match.timerInterval) clearInterval(match.timerInterval);
        io.to(matchId).emit('matchCancelled', { reason: 'حریف از مسابقه خارج شد' });
        setTimeout(() => delete matches[matchId], 3000);
        break;
      }
    }
  });

  socket.on('getLeaderboard', () => {
    socket.emit('leaderboardData', leaderboard);
  });
});

function updateLeaderboardAfterMatch(matchId) {
  const match = matches[matchId];
  if (!match || !match.winner) return;

  const players = match.players;
  const usernames = match.usernames;
  const winnerId = match.winner;
  const loserId = players.find(id => id !== winnerId);

  const winnerName = usernames[players.indexOf(winnerId)];
  const loserName = usernames[players.indexOf(loserId)];

  if (!leaderboard[winnerName]) leaderboard[winnerName] = { wins: 0, losses: 0, totalClicks: 0 };
  if (!leaderboard[loserName]) leaderboard[loserName] = { wins: 0, losses: 0, totalClicks: 0 };

  leaderboard[winnerName].wins += 1;
  leaderboard[loserName].losses += 1;
  leaderboard[winnerName].totalClicks = (leaderboard[winnerName].totalClicks || 0) + match.clicks[winnerId];
  leaderboard[loserName].totalClicks = (leaderboard[loserName].totalClicks || 0) + match.clicks[loserId];

  saveLeaderboard(leaderboard);
  io.emit('leaderboardData', leaderboard);
}

http.listen(PORT, () => {
  console.log(`🚀 سرور روی پورت ${PORT} اجرا شد`);
  leaderboard = loadLeaderboard();
});
