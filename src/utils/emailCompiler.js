/**
 * SFMC Content Builder asset compiler.
 * Source: https://developer.salesforce.com/docs/marketing/marketing-cloud/guide/compiling-asset-model.html
 *
 * Resolves <div data-type="slot"> and <div data-type="block"> references
 * in Content Builder asset content, returning the final compiled HTML string.
 */

function getReferences(content, type) {
  var typeMarker = '<div data-type="' + type + '" data-key="'
  var splitContent = content.split(typeMarker)
  var results = []
  if (splitContent.length > 1) {
    for (var i = 1; i < splitContent.length; i++) {
      var endTagMatches = splitContent[i].match(/(\/>)|(>[^<]*<\/div>)/i)
      var match = endTagMatches[0] || '>'
      results.push(typeMarker + splitContent[i].split(match)[0] + match)
    }
  }
  return results
}

export function compile(asset, channel) {
  asset = asset || {}
  var content = asset.superContent || asset.content || asset.design
  if (content) {
    ;['slot', 'block'].forEach(function (type) {
      var references = getReferences(content, type)
      var types = type + 's'
      references.forEach(function (reference) {
        var refKey = reference.split('data-key="')[1].split('"')[0]
        if (asset[types] && asset[types][refKey]) {
          content = content.replace(reference, compile(asset[types][refKey]))
        } else {
          console.warn('[emailCompiler] referenced ' + type + ' not found: ' + refKey)
        }
      })
    })
    return content
  } else if (asset.views) {
    if (asset.views[channel]) {
      return compile(asset.views[channel], channel)
    } else if (asset.views.html) {
      return compile(asset.views.html, channel)
    }
  }
  return ''
}
