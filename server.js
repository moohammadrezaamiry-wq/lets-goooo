const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

// سرو کردن فایل‌های استاتیک (HTML, CSS, JS)
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'coffee_clicker.html'));
});

io.on('connection', (socket) => {
  console.log('کاربر متصل:', socket.id);

  socket.on('identify', ({ deviceId }) => {
    socket.emit('identity', { username: null }); // بعداً گسترش بده
  });

  socket.on('register', ({ deviceId, username }) => {
    // منطق ثبت‌نام ساده
    socket.emit('registerSuccess', { username });
    io.emit('leaderboardData', {});
  });

  socket.on('addClicks', () => {});
  socket.on('joinQueue', () => {
    socket.emit('waiting', { message: 'در حال جستجو...' });
  });
  socket.on('getLeaderboard', () => {
    socket.emit('leaderboardData', {});
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 سرور روی پورت ${PORT} آماده است`);
});    }
    socket.emit('registerSuccess', { username });
    io.emit('leaderboardData', leaderboard);
  });

  socket.on('addClicks', ({ count }) => {
    const username = Object.values(users).find(u => true); // ساده‌سازی موقتی
    // بهتره username رو با deviceId map کنیم
    // فعلاً فقط برای دمو
    if (username && leaderboard[username]) {
      leaderboard[username].totalClicks = (leaderboard[username].totalClicks || 0) + count;
      io.emit('leaderboardData', leaderboard);
    }
  });

  // ========== PvP Queue ==========
  let queue = [];
  let matches = {};

  socket.on('joinQueue', () => {
    if (queue.includes(socket.id)) return;
    queue.push(socket.id);
    socket.emit('waiting', { message: 'در حال جستجوی حریف...' });

    if (queue.length >= 2) {
      const p1 = queue.shift();
      const p2 = queue.shift();

      const matchId = 'match_' + Date.now();
      matches[matchId] = {
        players: [p1, p2],
        clicks: { [p1]: 0, [p2]: 0 },
        duration: 60,
        timer: null
      };

      io.to(p1).to(p2).emit('matchStart', {
        matchId,
        players: [
          { id: p1, username: getUsername(p1) },
          { id: p2, username: getUsername(p2) }
        ],
        duration: 60
      });

      // تایمر
      matches[matchId].timer = setInterval(() => {
        matches[matchId].duration--;
        io.to(p1).to(p2).emit('timerUpdate', { remaining: matches[matchId].duration });

        if (matches[matchId].duration <= 0) {
          endMatch(matchId);
        }
      }, 1000);
    }
  });

  socket.on('pvpClick', ({ matchId, count }) => {
    const match = matches[matchId];
    if (!match) return;

    match.clicks[socket.id] = (match.clicks[socket.id] || 0) + count;
    io.to(match.players[0]).to(match.players[1]).emit('clickUpdate', {
      playerId: socket.id,
      clicks: match.clicks[socket.id]
    });
  });

  function getUsername(socketId) {
    // پیدا کردن username بر اساس deviceId (ساده‌سازی)
    return Object.keys(users).find(key => true) || 'ناشناس';
  }

  function endMatch(matchId) {
    const match = matches[matchId];
    if (!match) return;

    clearInterval(match.timer);

    const [p1, p2] = match.players;
    const c1 = match.clicks[p1] || 0;
    const c2 = match.clicks[p2] || 0;

    let winner = null;
    if (c1 > c2) winner = p1;
    else if (c2 > c1) winner = p2;

    io.to(p1).to(p2).emit('matchEnd', { winner });

    // به‌روزرسانی لیدربورد
    const u1 = getUsername(p1);
    const u2 = getUsername(p2);
    if (leaderboard[u1]) leaderboard[u1].wins += (winner === p1 ? 1 : 0);
    if (leaderboard[u2]) leaderboard[u2].wins += (winner === p2 ? 1 : 0);

    delete matches[matchId];
    io.emit('leaderboardData', leaderboard);
  }

  socket.on('getLeaderboard', () => {
    socket.emit('leaderboardData', leaderboard);
  });

  socket.on('disconnect', () => {
    queue = queue.filter(id => id !== socket.id);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 سرور روی پورت ${PORT} اجرا شد`);
});      socket.emit('identity', null);
    }
  });

  socket.on('addClicks', ({ count }) => {
    if (!socket.username) return;
    if (!leaderboard[socket.username]) {
      leaderboard[socket.username] = { wins: 0, losses: 0, totalClicks: 0 };
    }
    leaderboard[socket.username].totalClicks = (leaderboard[socket.username].totalClicks || 0) + count;
    saveLeaderboard();
    io.emit('leaderboardData', leaderboard);
  });

  socket.on('getLeaderboard', () => {
    socket.emit('leaderboardData', leaderboard);
  });

  socket.on('getAdminUsers', () => {
    socket.emit('adminUsersData', leaderboard);
  });

  socket.on('adminSaveUser', ({ username, clicks }) => {
    if (!leaderboard[username]) {
      leaderboard[username] = { wins: 0, losses: 0, totalClicks: 0 };
    }
    leaderboard[username].totalClicks = clicks;
    saveLeaderboard();
    io.emit('leaderboardData', leaderboard);
    socket.emit('adminUserSaved');
  });

  socket.on('adminDeleteUser', ({ username }) => {
    delete leaderboard[username];
    saveLeaderboard();
    for (const [devId, user] of Object.entries(deviceDB)) {
      if (user === username) delete deviceDB[devId];
    }
    saveDeviceDB();
    io.emit('leaderboardData', leaderboard);
    socket.emit('adminUserDeleted');
  });

  socket.on('adminResetAll', () => {
    for (let user in leaderboard) {
      leaderboard[user].wins = 0;
      leaderboard[user].losses = 0;
      leaderboard[user].totalClicks = 0;
    }
    saveLeaderboard();
    io.emit('leaderboardData', leaderboard);
    socket.emit('adminAllReset');
  });

  socket.on('joinQueue', () => {
    if (!socket.username) {
      socket.emit('error', 'لطفاً ابتدا ثبت‌نام کنید.');
      return;
    }

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

  socket.on('pvpClick', ({ matchId, count }) => {
    const match = matches[matchId];
    if (!match || match.finished) return;
    if (!match.players.includes(socket.id)) return;

    match.clicks[socket.id] = (match.clicks[socket.id] || 0) + count;
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

  saveLeaderboard();
  io.emit('leaderboardData', leaderboard);
}

http.listen(PORT, () => {
  console.log(`🚀 سرور روی پورت ${PORT} اجرا شد`);
  deviceDB = readJSON(DEVICE_DB_FILE);
  leaderboard = readJSON(LEADERBOARD_FILE);
});
app.use(express.static('public'));

let waitingPlayers = [];
const matches = {};

io.on('connection', (socket) => {
  console.log('🔵 کاربر متصل:', socket.id);

  socket.on('register', ({ deviceId, username }) => {
    username = username.trim();
    if (!username || username.length < 2) {
      socket.emit('registerError', 'نام کاربری باید حداقل ۲ کاراکتر باشد.');
      return;
    }
    const existingDevice = Object.keys(deviceDB).find(d => deviceDB[d] === username);
    if (existingDevice && existingDevice !== deviceId) {
      socket.emit('registerError', 'این نام قبلاً توسط دستگاه دیگری ثبت شده است.');
      return;
    }
    deviceDB[deviceId] = username;
    saveDeviceDB();
    if (!leaderboard[username]) {
      leaderboard[username] = { wins: 0, losses: 0, totalClicks: 0 };
      saveLeaderboard();
    }
    socket.username = username;
    socket.deviceId = deviceId;
    socket.emit('registerSuccess', { username, deviceId });
    io.emit('leaderboardData', leaderboard);
  });

  socket.on('identify', ({ deviceId }) => {
    const username = deviceDB[deviceId];
    if (username) {
      socket.username = username;
      socket.deviceId = deviceId;
      socket.emit('identity', { username, deviceId });
    } else {
      socket.emit('identity', null);
    }
  });

  socket.on('addClicks', ({ count }) => {
    if (!socket.username) return;
    if (!leaderboard[socket.username]) {
      leaderboard[socket.username] = { wins: 0, losses: 0, totalClicks: 0 };
    }
    leaderboard[socket.username].totalClicks = (leaderboard[socket.username].totalClicks || 0) + count;
    saveLeaderboard();
    io.emit('leaderboardData', leaderboard);
  });

  socket.on('getLeaderboard', () => {
    socket.emit('leaderboardData', leaderboard);
  });

  socket.on('joinQueue', () => {
    if (!socket.username) {
      socket.emit('error', 'لطفاً ابتدا ثبت‌نام کنید.');
      return;
    }

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

  socket.on('pvpClick', ({ matchId, count }) => {
    const match = matches[matchId];
    if (!match || match.finished) return;
    if (!match.players.includes(socket.id)) return;

    match.clicks[socket.id] = (match.clicks[socket.id] || 0) + count;
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

  saveLeaderboard();
  io.emit('leaderboardData', leaderboard);
}

http.listen(PORT, () => {
  console.log(`🚀 سرور روی پورت ${PORT} اجرا شد`);
  deviceDB = readJSON(DEVICE_DB_FILE);
  leaderboard = readJSON(LEADERBOARD_FILE);
});    saveLeaderboard();
    io.emit('leaderboardData', leaderboard);
  });

  // ---- درخواست لیدربورد ----
  socket.on('getLeaderboard', () => {
    socket.emit('leaderboardData', leaderboard);
  });

  // ---- دریافت لیست کاربران برای ادمین ----
  socket.on('getAdminUsers', () => {
    // فقط به خود کاربر ارسال می‌شود (درخواست‌کننده)
    socket.emit('adminUsersData', leaderboard);
  });

  // ---- ذخیره امتیاز توسط ادمین ----
  socket.on('adminSaveUser', ({ username, clicks }) => {
    if (!leaderboard[username]) {
      leaderboard[username] = { wins: 0, losses: 0, totalClicks: 0 };
    }
    leaderboard[username].totalClicks = clicks;
    saveLeaderboard();
    io.emit('leaderboardData', leaderboard);
    socket.emit('adminUserSaved');
  });

  // ---- حذف کاربر توسط ادمین ----
  socket.on('adminDeleteUser', ({ username }) => {
    delete leaderboard[username];
    saveLeaderboard();
    // حذف دستگاه‌های مرتبط
    for (const [devId, user] of Object.entries(deviceDB)) {
      if (user === username) delete deviceDB[devId];
    }
    saveDeviceDB();
    io.emit('leaderboardData', leaderboard);
    socket.emit('adminUserDeleted');
  });

  // ---- ریست همه امتیازها توسط ادمین ----
  socket.on('adminResetAll', () => {
    for (let user in leaderboard) {
      leaderboard[user].wins = 0;
      leaderboard[user].losses = 0;
      leaderboard[user].totalClicks = 0;
    }
    saveLeaderboard();
    io.emit('leaderboardData', leaderboard);
    socket.emit('adminAllReset');
  });

  // ---- PvP: ورود به صف ----
  socket.on('joinQueue', () => {
    if (!socket.username) {
      socket.emit('error', 'لطفاً ابتدا ثبت‌نام کنید.');
      return;
    }

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

  // ---- دریافت کلیک در مسابقه ----
  socket.on('pvpClick', ({ matchId, count }) => {
    const match = matches[matchId];
    if (!match || match.finished) return;
    if (!match.players.includes(socket.id)) return;

    match.clicks[socket.id] = (match.clicks[socket.id] || 0) + count;
    io.to(matchId).emit('clickUpdate', {
      playerId: socket.id,
      clicks: match.clicks[socket.id],
      total: match.clicks
    });
  });

  // ---- قطع اتصال ----
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
});

// ========== به‌روزرسانی لیدربورد بعد از مسابقه ==========
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

  saveLeaderboard();
  io.emit('leaderboardData', leaderboard);
}

// ========== اجرای سرور ==========
http.listen(PORT, () => {
  console.log(`🚀 سرور روی پورت ${PORT} اجرا شد`);
  deviceDB = readJSON(DEVICE_DB_FILE);
  leaderboard = readJSON(LEADERBOARD_FILE);
});      return;
    }

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

  socket.on('pvpClick', ({ matchId, count }) => {
    const match = matches[matchId];
    if (!match || match.finished) return;
    if (!match.players.includes(socket.id)) return;

    match.clicks[socket.id] = (match.clicks[socket.id] || 0) + count;
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

  saveLeaderboard();
  io.emit('leaderboardData', leaderboard);
}

http.listen(PORT, () => {
  console.log(`🚀 سرور روی پورت ${PORT} اجرا شد`);
  deviceDB = readJSON(DEVICE_DB_FILE);
  leaderboard = readJSON(LEADERBOARD_FILE);
});
