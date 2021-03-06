//process.env.PGSSLMODE = 'prefer';

var pg = require('pg');
try {
  if (process.platform == "darwin") {
    var pg = pg.native;
  }
} catch (error) {
  console.log("can not load pg-native, using pg");
  console.error(error);
  errorReporter(error);
}

var sprintf = require("sprintf-js").sprintf,
    vsprintf = require("sprintf-js").vsprintf;

global.Connection = jClass.extend({
  className: 'Connection',
  defaultDatabaseName: 'template1',
  history: [],
  logging: true,
  pending: [],
  printTestingError: true,

  init: function(options, callback) {
    this.options = options;
    this.connection = null;
    global.Connection.instances.push(this);
    this.connectToServer(options, callback);
    this.notificationCallbacks = [];
  },

  parseConnectionString: function (postgresUrl) {
    var step1 = postgresUrl.match(/^(postgres:\/\/)([\w\d_]+)(:([^@]+))?@/); // protocol, user, [password]
    var step2 = postgresUrl.match(/@([^\/:]+)(:(\d+))?(\/([^\/\?]+))/); // host, [port], db name
    var step3 = postgresUrl.match(/\?(.+)$/); // query string

    return {
      user: step1[2],
      password: step1[4],
      host: step2[1],
      port: (step2[3] || '5432').toString(),
      database: step2[5] || this.defaultDatabaseName,
      query: step3 && step3[1]
    };
  },

  connectToServer: function (options, callback) {
    var connectString;

    if (typeof options == 'object') {
      // set defaults
      if (options.port == undefined) options.port = '5432';
      if (options.host == undefined) options.host = 'localhost';

      if (!options.database) options.database = this.defaultDatabaseName;

      var connectString = 'postgres://' + options.user + ':' + 
        options.password + '@' + options.host + ':' + 
        options.port + '/' + options.database;
      if (options.query) {
        connectString += "?" + options.query;
      }
    } else {
      connectString = options;
      options = this.parseConnectionString(connectString);
      this.options = options;
    }

    log.info('Connecting to', connectString);

    if (this.connection) {
      this.connection.end();
      this.connection = null;
    }

    pg.connect(connectString, function (error, client) {
      this.connection = client;
      if (error) {
        callback && callback(false, error.message);
        console.log(error);
        App.log("connect.error", this, JSON.parse(JSON.stringify(this.options)), error);
      } else {
        this.connection.on('notification', function(msg) {
          this.notificationCallbacks.forEach(function (fn) {
            fn(msg);
          });
          App.log("notification.recieved", msg);
        }.bind(this));

        this.serverVersion(function (version) {
          console.log("Server version is", version);
          this.pending.forEach(function (cb) {
            cb();
          });
          this.pending = [];
          callback && callback(true);
        }.bind(this));
        App.log("connect.success", this, JSON.parse(JSON.stringify(this.options)));
      }
    }.bind(this));
  },

  reconnect: function (callback) {
    if (this.connection) {
      this.connection.end();
      this.connection = null;
    }
    this.connectToServer(this.options, callback);
  },

  switchDb: function(database, callback) {
    this.options.database = database;
    this.connectToServer(this.options, callback);
  },

  onReady: function (callback) {
    if (this.connection) {
      callback();
    } else {
      this.pending.push(callback);
    }
  },

  query: function (sql, callback) {
    this.onReady(function () {
      if (this.logging) logger.print("SQL: " + sql.green + "\n");

      var historyRecord = { sql: sql, date: (new Date()), state: 'running' };
      this.history.push(historyRecord);
      App.log("sql.start", historyRecord);
      var time = Date.now();

      var query = this.connection.query(sql, function (error, result) {
        historyRecord.time = Date.now() - time;
        if (this.logging) logger.print("SQL:" + " Done ".green + historyRecord.time + "\n");

        if (global.TESTING && this.printTestingError && error) {
          if (this.logging) logger.print("FAILED: " + sql.yellow + "\n");
          log.error(error);
        }

        if (error) {
          historyRecord.error = error;
          historyRecord.state = 'failed';
          App.log("sql.failed", historyRecord);
          error.query = sql;
          console.error("SQL failed", sql);
          console.error(error);
          query.state = 'error';
          if (callback) callback(result, error);
          this.onConnectionError(error);
        } else {
          historyRecord.state = 'success';
          App.log("sql.success", historyRecord);
          result.time = historyRecord.time;
          //console.log(result);
          if (callback) callback(result);
        }
      }.bind(this));
    }.bind(this));
  },

  q: function(sql) {
    var params = [], i;
    var callback = arguments[arguments.length - 1];
    for (i = 1; i < arguments.length - 1; i++) params.push(arguments[i]);

    this.query(vsprintf(sql, params), callback);
  },

  serialize: function(sql){
    var params = [], i;
    var callback = arguments[arguments.length - 1];
    for (i = 1; i < arguments.length - 1; i++) params.push(arguments[i]);

    return vsprintf(sql, params)
  },

  listDatabases: function (callback) {
    var databases = [];
    this.query('SELECT datname FROM pg_database WHERE datistemplate = false;', function (rows) {
      rows.rows.forEach(function(dbrow) {
        databases.push(dbrow.datname);
      });
      callback(databases);
    });
  },

  databaseTemplatesList: function (callback) {
    var databases = [];
    this.query('SELECT datname FROM pg_database WHERE datistemplate = true;', function (rows) {
      rows.rows.forEach(function(dbrow) {
        databases.push(dbrow.datname);
      });
      callback(databases);
    });
  },

  avaliableEncodings: function (callback) {
    var encodings = [];
    this.query('select pg_encoding_to_char(i) as encoding from generate_series(0,100) i', function(rows) {
      rows.rows.forEach(function(dbrow) {
        if (dbrow.encoding != '') encodings.push(dbrow.encoding);
      });
      callback(encodings);
    });
  },

  serverVersion: function (callback) {
    if (this._serverVersion != undefined) {
      callback(this._serverVersion, this._serverVersionFull);
      return;
    }

    if (this.connection.native && this.connection.native.pq.serverVersion) {
      var intVersion = this.connection.native.pq.serverVersion();
      var majorVer = ~~ (intVersion / 10000);
      var minorVer = ~~ (intVersion % 10000 / 100);
      var patchVer = intVersion % 100;
      this._serverVersion = [majorVer, minorVer, patchVer].join(".");
      callback(this._serverVersion);
      return;
    }

    console.log("Client don't support serverVersion, getting it with sql");
    this.query('SELECT version()', function (result, error) {
      var version = result.rows[0].version.split(" ")[1];
      this._serverVersion = version;
      this._serverVersionFull = result.rows[0].version;
      callback(this._serverVersion, this._serverVersionFull);
    }.bind(this));
  },

  supportMatViews: function () {
    return this._serverVersion >= "9.3";
  },

  getVariable: function(variable, callback) {
    this.q('show %s', variable, function (data, error) {
      var vname = Object.keys(data.rows[0])[0];
      callback(data.rows[0][vname]);
    });
  },

  publicTables: function(callback) {
    this.query("SELECT * FROM information_schema.tables where table_schema = 'public';", function(rows, error) {
      callback(rows.rows, error);
    });
  },

  tablesAndSchemas: function(callback) {
    var data = {};
    var sql = "SELECT * FROM information_schema.tables order by table_schema != 'public', table_name;";
    this.query(sql, function(rows) {
      rows.rows.forEach(function(dbrow) {
        if (!data[dbrow.table_schema]) data[dbrow.table_schema] = [];
        data[dbrow.table_schema].push(dbrow);
      });
      callback(data);
    });
  },

  mapViewsAsTables: function (callback) {
    if (!this.supportMatViews()) {
      callback([]);
      return;
    }

    var data = {};
    var sql = "select schemaname as table_schema, matviewname as table_name, 'MATERIALIZED VIEW' as table_type " +
              "from pg_matviews " +
              "order by schemaname != 'public', matviewname";

    this.query(sql, function(result, error) {
      if (error) {
        log.error(error.message);
        callback([]);
        return;
      }
      result.rows.forEach(function(dbrow) {
        if (!data[dbrow.table_schema]) data[dbrow.table_schema] = [];
        data[dbrow.table_schema].push(dbrow);
      });
      callback(data);
    });
  },

  tableSchemas: function (callback) {
    var sql = "select table_schema from information_schema.tables group by table_schema " +
              "order by table_schema != 'public'";
    this.query(sql, function (rows) {
      var data = rows.rows.map(function(dbrow) {
        return dbrow.table_schema;
      });
      callback(data);
    })
  },

  getExtensions: function(callback) {
    // 'select * from pg_available_extensions order by (installed_version is null), name;'
    this.q('select * from pg_available_extensions order by name;', function(data) {
      callback(data.rows);
    });
  },

  installExtension: function (extension, callback) {
    this.q('CREATE EXTENSION "%s"', extension, callback);
  },

  uninstallExtension: function (extension, callback) {
    this.q('DROP EXTENSION "%s"', extension, callback);
  },

  createDatabase: function(dbname, template, encoding, callback) {
    var sql = "CREATE DATABASE %s";
    if (encoding) sql += " ENCODING '" + encoding + "'";
    if (template) sql += " TEMPLATE " + template;
    this.q(sql, dbname, callback);
  },

  dropDatabase: function (dbname, callback) {
    this.switchDb('postgres', function () {
      this.q('drop database "%s"', dbname, function (result, error) {
        callback(result, error);
      });
    }.bind(this));
  },

  renameDatabase: function (dbname, newDbname, callback) {
    this.switchDb('postgres', function () {
      var sql = 'ALTER DATABASE "%s" RENAME TO "%s";'
      this.q(sql, dbname, newDbname, function (result, error) {
        this.switchDb(error ? dbname : newDbname, function () {
          callback(result, error);
        });
      }.bind(this));
    }.bind(this));
  },

  queryMultiple: function(queries, callback) {
    var leftQueries = queries.slice();
    var conn = this;

    var lastResult;

    var runner = function () {
      if (leftQueries.length == 0) {
        callback(lastResult);
        return;
      }

      var sql = leftQueries.shift();
      conn.query(sql, function (reuslt, error) {
        if (error) {
          callback(reuslt, error);
        } else {
          lastResult = reuslt;
          runner();
        }
      });
    };

    runner();
  },

  dropUserFunctions: function (namespace, callback) {
    if (typeof callback == 'undefined' && typeof namespace == 'function') {
      callback = namespace;
      namespace = undefined;
    }
    if (!namespace) namespace = 'public';

      sql = "SELECT 'DROP ' || (CASE WHEN proisagg THEN 'AGGREGATE' ELSE 'FUNCTION' END) || ' IF EXISTS ' || ns.nspname || '.' || proname || '(' || oidvectortypes(proargtypes) || ');' as cmd " +
          "FROM pg_proc INNER JOIN pg_namespace ns ON (pg_proc.pronamespace = ns.oid) " +
          "WHERE ns.nspname = '%s'  order by proname;"

    this.q(sql, namespace, function (result, error) {
      if (error) {
        callback(result, error);
      } else {
        if (result.rows.length) {
          var dropSql = [];
          result.rows.forEach(function(row) {
            dropSql.push(row.cmd);
          });
          this.queryMultiple(dropSql, callback);
        } else {
          callback(result);
        }
      }
    }.bind(this));
  },

  dropAllSequesnces: function (callback) {
    var sql = "SELECT 'drop sequence ' || c.relname || ';' as cmd FROM pg_class c WHERE (c.relkind = 'S');";

    this.q(sql, function (result, error) {
      if (error) {
        callback(result, error);
      } else {
        if (result.rows.length) {
          var dropSql = [];
          result.rows.forEach(function(row) {
            dropSql.push(row.cmd);
          });
          this.queryMultiple(dropSql, callback);
        } else {
          callback(result);
        }
      }
    }.bind(this));
  },

  close: function (callback) {
    if (this.connection) {
      this.connection.end();
    }
    var index = global.Connection.instances.indexOf(this);
    if (index != -1) {
      global.Connection.instances.splice(index, 1);
    }
    callback && callback();
  },

  reconnect: function (callback) {
    this.close(function () {
      this.connectToServer(this.options, callback);
    }.bind(this));
  },

  onNotification: function (callback) {
    this.notificationCallbacks.push(callback);
  },

  onConnectionError: function (error) {
    if (
      error.message.indexOf("server closed the connection unexpectedly") != -1 ||
      error.message.indexOf("Unable to set non-blocking to true") != -1) {

      var that = this;

      window.alertify.confirm("Seems like disconnected, reconnect?<br><small>" + error.message, function (is_yes) {
        window.alertify.hide();
        if (is_yes) {
          var tab = global.App.tabs.filter(function (tab) {
            return tab.instance.connection == that;
          })[0];

          if (tab) tab.instance.reconnect();
        }
      });
    }
  }
});

global.Connection.PG = pg;
global.Connection.instances = [];