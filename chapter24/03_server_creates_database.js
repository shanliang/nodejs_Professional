var nano = require('nano');
var couchdb = nano('https://myiriscouchserver.iriscouch.com');

var couchMapReduce = function (doc) {
  emit([doc.room, doc.when], doc);
};

couchdb.db.create('chat', function(err) {
  if (err && err.status_code !== 412) {
    throw err;
  }

  var designDoc = {
    language: "javascript",
    views: {
      by_room: {
        map: couchMapReduce.toString()
      }
    }
  };

  var chatDB = couchdb.use('chat');

  (function insertOrUpdateDesignDoc() {
    chatDB.insert(designDoc, '_design/designdoc', function(err) {
      if (err) {
        if (err.status_code === 409) {
          chatDB.get('_design/designdoc', function(err, ddoc) {
            if (err) { return console.error(err); }
            designDoc._rev = ddoc._rev;
            insertOrUpdateDesignDoc();
          });
        } else {
          return console.error(err);
        }
      }
      startServer();
    });
  }());
});

function startServer() {
  var chatDB = couchdb.use('chat');

  var httpd = require('http').createServer(handler);
  var io = require('socket.io').listen(httpd);
  var fs = require('fs');

  httpd.listen(4000);

  function handler(req, res) {
    fs.readFile(__dirname + '/index.html',
      function(err, data) {
        if (err) {
         res.writeHead(500);
         return res.end('Error loading index.html');
        }

        res.writeHead(200);
        res.end(data);
      }
    );
  }

  var chat = io.of('/chat');

  chat.on('connection', function (socket) {
    socket.on('clientMessage', function(content) {
      socket.emit('serverMessage', 'You said: ' + content);

      socket.get('username', function(err, username) {
        if (! username) {
          username = socket.id;
        }
        socket.get('room', function(err, room) {
          if (err) { throw err; }
          var broadcast = socket.broadcast;
          var message = content;
          if (room) {
            broadcast.to(room);
          }

          var messageDoc = {
            when: Date.now(),
            from: username,
            room: room,
            message: content
          };

          chatDB.insert(messageDoc, function(err) {
            if (err) { console.error(err); }
          });

          broadcast.emit('serverMessage', username + ' said: ' + message);
        });
      });
    });

    socket.on('login', function(username) {
      socket.set('username', username, function(err) {
        if (err) { throw err; }
        socket.emit('serverMessage', 'Currently logged in as ' + username);
        socket.broadcast.emit('serverMessage', 'User ' + username + ' logged in');
      });
    });

    socket.on('disconnect', function() {
      socket.get('username', function(err, username) {
        if (! username) {
          username = socket.id;
        }
        socket.broadcast.emit('serverMessage', 'User ' + username +
          ' disconnected');
      });
    });

    socket.on('join', function(room) {
      socket.get('room', function(err, oldRoom) {
        if (err) { throw err; }

        socket.set('room', room, function(err) {
          if (err) { throw err; }
          socket.join(room);
          if (oldRoom) {
            socket.leave(oldRoom);
          }
          socket.get('username', function(err, username) {
            if (! username) {
              username = socket.id;
            }
          });
          socket.emit('serverMessage', 'You joined room ' + room);
          socket.get('username', function(err, username) {
            if (! username) {
              username = socket.id;
            }
            socket.broadcast.to(room).emit('serverMessage', 'User ' +
              username + ' joined this room');
          });
        });
      });
    });

    socket.emit('login');

  });
}