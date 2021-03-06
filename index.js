global.errorReporter = require('./lib/error_reporter');
require('classy/object_extras').extendGlobal();

//require('./lib/zepto');
require('./lib/dominate');
require('./lib/jquery.class');
require('./lib/alertify');
require('./lib/arg');
require('./lib/node_lib');
//global.AppMenu = require('nw-appmenu');
require('./lib/sidebar_resize');
require('./lib/query_tab_resizer');
require('./lib/widgets/generic_table');
require('./lib/psql_runner');
require('./lib/sql_importer');
require('./lib/pg_dump_runner');
require('./lib/sql_exporter');
require('./lib/pg_type_names');
require('classy/object_ls');
require('./lib/sql_snippets');

global.node.colors = require('colors');
global.node.colors.enabled = true;

require('./app');
require('./app/views/pane');
require('./app/connection');
require('./app/view_helpers');
require('./app/db_screen');
require('./app/login_screen');
require('./app/help_screen');
require('./app/views/db_screen');
require('./app/views/snippets');
require('./app/views/panes/users');
require('./app/views/panes/extensions');
require('./app/views/panes/query');
require('./app/views/panes/structure');
require('./app/views/panes/contents');
require('./app/views/panes/procedures');
require('./app/views/panes/info');

require('./app/views/dialog');
require('./app/views/dialogs/new_user');
require('./app/views/dialogs/new_table');
require('./app/views/dialogs/edit_user');
require('./app/views/dialogs/new_database');
require('./app/views/dialogs/new_column');
require('./app/views/dialogs/edit_column');
require('./app/views/dialogs/new_index');
require('./app/views/dialogs/import_file');
require('./app/views/dialogs/heroku_connection');
require('./app/views/dialogs/list_languages');
require('./app/views/dialogs/export_file');
require('./app/views/dialogs/show_sql');
require('./app/views/dialogs/edit_procedure');
require('./app/views/dialogs/def_procedure');

require('./app/models/base');
require('./app/models/table');
require('./app/models/column');
require('./app/models/saved_conn');
require('./app/models/last_query');
require('./app/models/procedure');
require('./app/models/trigger');
require('./app/models/user');

require('./app/controllers/import_controller');
require('./app/controllers/export_controller');
require('./app/controllers/updates_controller');

require('./app/heroku_client');
require('./app/history_window');

global.$u = window.$u = Zepto;
global.$ = function (selector) {
  return document.querySelector(selector);
};

global.$dom = function(tags) { return global.DOMinate(tags)[0]; };

require('./app/utils');

function reloadCss() {
  var queryString = '?reload=' + new Date().getTime();
  global.$u('link[rel="stylesheet"]').each(function () {
    this.href = this.href.replace(/\?.*|$/, queryString);
  });
}

//var gui = require('nw.gui');
//global.gui = gui;
global.electron = require('electron');


if (!process.platform.match(/^win/) && !process.platform.match(/^linux/)) { // win32, win64, win128, etc
  require('./app/top_menu');
}

Zepto(document).ready(function() {
  global.App.init();
  //renderHome();
  Zepto(window).bind('resize', function () {
    global.App.setSizes();
  });

  $u.makeDroppable(document.body, function (path) {
    var importer = new global.ImportController();
    importer.filename = path;
    importer.showImportDialog();
  });

  window.Mousetrap.bind("down", function () {
    GenericTable.keyPressed('down');
    return false;
  });

  window.Mousetrap.bind("up", function () {
    GenericTable.keyPressed('up');
    return false;
  });

  window.Mousetrap.bind(["backspace", "del"], function () {
    GenericTable.keyPressed('backspace');
  });

  electron.ipcRenderer.on('Snippet.insert', function(event, message) {
    console.log('Snippet.insert', event, message);
    Panes.Contents.insertSnippet(message);
  });

  setTimeout(function () {
    console.log("Checking updates info");
    (new global.UpdatesController).checkUpdates();
  }, 10000);

  /*
  var win = gui.Window.get();
  win.focus();

  win.on('closed', function() {
    if (global.App.snippersWin) {
      global.App.snippersWin.close();
    }
    if (global.App.historyWin) {
      global.App.historyWin.close();
    }
  });
  */
});
