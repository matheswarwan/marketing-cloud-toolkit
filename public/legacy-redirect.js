// SFMC Query Saver's pages, kept so bookmarks and links still work after the
// update to Marketing Cloud Toolkit: each one forwards to its section in app.html.
(function () {
  function target(path, search) {
    var page = path.split('/').pop() || 'index.html'
    var q = new URLSearchParams(search)
    var keep = function (names) {
      var out = new URLSearchParams()
      names.forEach(function (n) { if (q.get(n)) out.set(n, q.get(n)) })
      var s = out.toString()
      return s ? '?' + s : ''
    }
    switch (page) {
      case 'query-detail.html': return '#/queries/workspace' + keep(['ws', 'id', 'sql'])
      case 'query-builder.html': return '#/queries/builder' + keep(['id'])
      case 'email-detail.html': return q.get('id') ? '#/emails/' + encodeURIComponent(q.get('id')) : '#/emails'
      case 'features.html': return '#/features'
      case 'todo.html': return '#/todo'
      default: return '#/queries/saved'
    }
  }
  if (typeof module !== 'undefined') module.exports = { target: target }
  else location.replace('app.html' + target(location.pathname, location.search))
})()
