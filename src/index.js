/* @flow */
import path from 'path';
import vm from 'vm';
import React from 'react';
import ReactDOM from 'react-dom/server';
import { match, RouterContext } from 'react-router';
import async from 'async';
import Promise from 'bluebird';

import {
  getAllPaths,
  compileAsset,
  isRoute,
  renderSingleComponent,
  getAssetKey,
  debug,
} from './utils.js';
import { render } from './Html.js';
import type {
  OptionsShape,
} from './constants.js';

/**
 * All source will be compiled with babel so ES6 goes
 *
 * Usage:
 *
 *   new StaticSitePlugin({ src: 'client/routes.js', ...options }),
 *
 */

const validateOptions = (options) => {
  if (!options.routes) {
    throw new Error('No routes param provided');
  }
};

function StaticSitePlugin(options: OptionsShape) {
  validateOptions(options);
  this.options = options;
  this.render = this.options.template
    ? require(path.resolve(this.options.template))
    : render;
}

/**
 * compiler seems to be an instance of the Compiler
 * https://github.com/webpack/webpack/blob/master/lib/Compiler.js#L143
 *
 * NOTE: renderProps.routes is always passed as an array of route elements. For
 * deeply nested routes the last element in the array is the route we want to
 * get the props of, so we grab it out of the array and use it. This lets us do
 * things like:
 *
 *   <Route title='Blah blah blah...' {...moreProps} />
 *
 * Then set the document title to the title defined on that route
 *
 * NOTE: Sometimes when matching routes we do not get an error but nore do we
 * get renderProps. In my experience this usually means we hit an IndexRedirect
 * or some form of Route that doesn't actually have a component to render. In
 * these cases we simply keep on moving and don't render anything.
 *
 * TODO:
 * - Allow passing a function for title?
 *
 */
StaticSitePlugin.prototype.apply = function(compiler) {
  let compilationPromise;

  // Compile Routes, template and redux store (if applicable)
  // TODO: Support compiling template
  // TODO: Support compiling reduxStore
  // We likely need to do a Promise.all sort of thing to compile every asset we
  // need and act accordingly.
  compiler.plugin('make', (compilation, cb) => {
    const { routes } = this.options;
    compilationPromise = compileAsset({
      filepath: routes,
      outputFilename: 'routes.js',
      compilation,
      context: compiler.context,
    })
    .catch(err => new Error(err))
    .finally(cb);
  });

  /**
   * [1]: For now i'm assuming that if there is an _originalSource key then the
   * user is using uglifyjs. However, this may be a fragile check and could
   * benefit from refactoring. The optimal solution would likely be to simply
   * remove the uglify plugin from the child compiler. However this solution
   * doesn't feel generic.
   *
   * [2]: We want to allow the user the option of either export default routes or
   * export routes.
   *
   * NOTE: It turns out that vm.runInThisContext works fine while evaluate
   * failes. It seems evaluate the routes file in this example as empty, which
   * it should not be... Not sure if switching to vm from evaluate will cause
   * breakage so i'm leaving it in here with this note for now.
   */
  compiler.plugin('emit', (compilation, cb) => {
    compilationPromise
    .then((asset) => {
      if (asset instanceof Error) {
        return Promise.reject(asset);
      }

      if (asset._originalSource) {
        debug('Source appears to be minified with UglifyJsPlugin. Using asset._originalSource for child compilation instead');
      }

      const source = asset._originalSource || asset.source(); // [1]
      return vm.runInThisContext(source);
    })
    .catch(cb) // TODO: Eval failed, likely a syntax error in build
    .then((routes) => {
      if (!routes) {
        throw new Error(`File compiled with empty source: ${this.options.routes}`);
      }

      const Routes = routes.routes || routes; // [2]

      if (!isRoute(Routes)) {
        debug('Entrypoint or chunk name did not return a Route component. Rendering as individual component instead.');
        compilation.assets['index.html'] = renderSingleComponent(Routes, this.options, this.render);
        return cb();
      }

      const paths = getAllPaths(Routes);

      // TODO: This should be a debug log
      debug('Parsed routes:', paths);

      // Remove everything we don't want

      // TODO: Since we are using promises elsewhere it would make sense ot
      // promisify this async logic as well.
      async.forEach(paths,
        (location, callback) => {
          match({ routes: Routes, location }, (err, redirectLocation, renderProps) => {
            // Skip if something goes wrong. See NOTE above.
            if (err || !renderProps) {
              debug('Error matching route', err, renderProps);
              return callback();
            }

            const route = renderProps.routes[renderProps.routes.length - 1]; // See NOTE
            const body = ReactDOM.renderToString(<RouterContext {...renderProps} />);
            const { stylesheet, favicon, bundle } = this.options;
            const assetKey = getAssetKey(location);
            const doc = this.render({
              title: route.title,
              body,
              stylesheet,
              favicon,
              bundle,
            });

            compilation.assets[assetKey] = {
              source() { return doc; },
              size() { return doc.length; },
            };

            callback();
          });
        },
        err => {
          if (err) throw err;
          cb();
        }
      );
    });
  });

  // TODO: Remove the generated files such as routes, reduxStore and template

  // Fuck. This doesn't work. It somehow gets in front of the rest of our logic
  // and removes the assets before we have a chance to do anything with them in
  // the emit plugin.
  // Remove all chunk assets that were generated from this compmilation. See:
  // https://github.com/webpack/extract-text-webpack-plugin/blob/v1.0.1/loader.js#L68
  // compiler.plugin('after-compile', (compilation, cb) => {
  //   delete compilation.assets['routes.js'];
  //   cb();
  // });
};

module.exports = StaticSitePlugin;
