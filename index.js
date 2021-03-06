'use strict'

// Load Dependencies
var _ = require('lodash')
var fm = require('front-matter')
var fs = require('fs')
var gutil = require('gulp-util')
var handlebars = require('handlebars')
var path = require('path')
var replaceExt = require('replace-ext')
var through = require('through2')
var toc = require('toc')

var markdownDefaults = require('./defaults/marked')
var markedMustacheDefaults = require('./defaults')
var tocDefaults = require('./defaults/toc')
var unified = require('unified')
var markdown = require('remark-parse')
var remark2rehype = require('remark-rehype')
var stringify = require('rehype-stringify')
var raw = require('rehype-raw')

var PLUGIN_NAME = 'gulp-marked-mustache'

// Render markdown. Applies different defaults to standard marked.
var renderMarkdown = function(input, options) {
  // Merge defaults with user options
  options = _.merge({}, markdownDefaults, options)

  var renderedHTML = unified()
    .use(markdown, {
      footnotes: true,
      pedantic: true,
      commonmark: true,
      gfm: true,
    })
    .use(remark2rehype, { allowDangerousHTML: true })
    .use(raw)
    .use(stringify)
    .processSync(input)
    .toString()

  // Return the processed markdown
  return renderedHTML
}

// Update links to markdown files with their HTML equivalent
var updateLinks = function(html) {
  return html.replace(/href=\"(.+?)(\.md)([\?\#].+?)?\"/g, function(
    match,
    path,
    extension,
    queryFragment
  ) {
    // If there is no query string or fragment, set the variable
    // to a zero-length string
    if (typeof queryFragment === 'undefined') {
      queryFragment = ''
    }

    // Don't update the link if it includes a protocol
    if (/^(\w+\:)?\/\//.test(path)) {
      return match
    } else {
      return 'href="' + path + '.html' + queryFragment + '"'
    }
  })
}

// Render a Table of Contents. Returns processed HTML and ToC.
var renderToc = function(html, options) {
  var data
  var output = {}

  // Merge defaults with user options
  options = _.merge({}, tocDefaults, options)

  // Analyse the HMTL and generate ToC data
  data = toc.anchorize(html, options)

  // Set the output HTML to the anchorised HTML
  output.body = data.html

  // Generate ToC HTML based on the ToC headers
  output.toc = toc.toc(data.headers, options)

  return output
}

// Load a mustache template
var loadTemplate = function(template) {
  try {
    return fs.readFileSync(template, 'utf-8')
  } catch (err) {
    // Fail silently if we can't load a template, as we'll return an
    // empty stream and keep processing the other files
  }
}

// Process the file
var processBuffer = function(file, options) {
  var data = fm(String(file.contents))
  var filePath
  var html
  var localOptions = {} // Per file options passed through front matter
  var template // Mustache template (NOT template path)
  var tocTemp // Temporary ToC data, if required
  var view = _.merge(options.view, data.attributes) // Set view data to that in file's front-matter

  if ('path' in file) {
    filePath =
      typeof data.attributes.path !== 'undefined'
        ? file.base + data.attributes.path
        : replaceExt(file.path, '.html')
  }

  // Set special local options from front matter
  localOptions.template = _.get(data, 'attributes.template', 'default')
  localOptions.toc = _.get(data, 'attributes.toc', true)

  // Convert markdown to HTML
  view.body = renderMarkdown(data.body)

  // Update the Markdown links to their HTML equivalent
  if (options.updateLinks !== false) {
    view.body = updateLinks(view.body)
  }

  // Add a ToC, if required
  if (options.toc !== false) {
    if (localOptions.toc !== false) {
      // Get to ToC HTML
      tocTemp = renderToc(view.body, options.toc)

      // Set the appropriate view properties to the corresponding ToC HTML
      view.body = tocTemp.body
      view.toc = tocTemp.toc
    } else {
      delete view.toc // Remove the toc property from the view data
    }
  }

  // Read the template
  template = loadTemplate(
    path.resolve(options.templatePath, localOptions.template + '.handlebars')
  )

  if (!template) {
    gutil.log(
      PLUGIN_NAME +
        ": unable to locate '" +
        localOptions.template +
        "' template for '" +
        file.relative +
        "', skipping..."
    )
    return null
  }

  // Compile the template
  const handlebarTemplate = handlebars.compile(template)
  html = handlebarTemplate(view)

  // Update the file object
  if (filePath) {
    file.path = filePath
  }

  file.contents = new Buffer(html)

  return file
}

var gulpMarkedMustache = function(options) {
  options = _.merge({}, markedMustacheDefaults, options)

  return through.obj(function(file, enc, cb) {
    if (file.isStream()) {
      cb(new gutil.PluginError(PLUGIN_NAME, 'Streaming not supported'))
      return
    } else if (file.isBuffer()) {
      file = processBuffer(file, options)
      if (!file) {
        cb()
        return
      }
    }

    cb(null, file)
  })
}

module.exports = gulpMarkedMustache
