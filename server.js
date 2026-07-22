const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// ========== فایل‌های ذخیره‌سازی ==========
const DEVICE_DB_FILE = path.join(__dirname, 'devices.json');    // deviceId -> username
const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json');

// ========== توابع خواندن/نوشتن ==========
function readJSON(file) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) { console.error('خطا در خواندن فایل:', e); }
  return {};
}

function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) { console.error('خطا در نوشتن فایل:', e); }
}

let deviceDB = readJSON(DEVICE_DB_FILE);      // { deviceId: username }
let leaderboard = readJSON(LEADERBOARD_FILE); // { username: { wins, losses, totalClicks } }

function saveDeviceDB() { writeJSON(DEVICE_DB_FILE, deviceDB); }
function saveLeaderboard() { writeJSON(LEADERBOARD_FILE, leaderboard); }

// ========== Express ==========
app.use(express.static('public'));

// ========== Socket.io ==========
let waitingPlayers = [];   // آرایه‌ای از socket.id
const matches = {};

io.on('connection', (socket) => {
  console.log('🔵 کاربر متصل:', socket.id);

  // ---- ثبت/ورود با Device ID ----
  socket.on('register', ({ deviceId, username }) => {
    username = username.trim();
    if (!username || username.length < 2) {
      socket.emit('registerError', 'نام کاربری باید حداقل ۲ کاراکتر باشد.');
      return;
    }

    // بررسی تکراری بودن نام
    const existingDevice = Object.keys(deviceDB).find(d => deviceDB[d] === username);
    if (existingDevice && existingDevice !== deviceId) {
      socket.emit('registerError', 'این نام قبلاً توسط دستگاه دیگری ثبت شده است.');
      return;
    }

    // ثبت یا به‌روزرسانی
    deviceDB[deviceId] = username;
    saveDeviceDB();

    // اگر کاربر جدید در لیدربورد نیست، اضافه کن
    if (!leaderboard[username]) {
      leaderboard[username] = { wins: 0, losses: 0, totalClicks: 0 };
      saveLeaderboard();
    }

    socket.username = username;
    socket.deviceId = deviceId;
    socket.emit('registerSuccess', { username, deviceId });
    io.emit('leaderboardData', leaderboard); // پخش لیدربورد به همه
  });

  // ---- دریافت Device ID برای تشخیص هویت ----
  socket.on('identify', ({ deviceId }) => {
    const username = deviceDB[deviceId];
    if (username) {
      socket.username = username;
      socket.deviceId = deviceId;
      socket.emit('identity', { username, deviceId });
    } else {
      socket.emit('identity', null); // دستگاه ناشناس
    }
  });

  // ---- اضافه کردن کلیک‌های عادی به لیدربورد ----
  socket.on('addClicks', ({ count }) => {
    if (!socket.username) return;
    if (!leaderboard[socket.username]) {
      leaderboard[socket.username] = { wins: 0, losses: 0, totalClicks: 0 };
    }
    leaderboard[socket.username].totalClicks = (leaderboard[socket.username].totalClicks || 0) + count;
    saveLeaderboard();
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
