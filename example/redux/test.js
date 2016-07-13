import test from 'ava';
import webpack from 'webpack';
import fs from 'fs';
import path from 'path';

import options from './webpack.config.prod.js';

test.cb('Supports redux apps that must be wrapped in <Provider>', t => {
  webpack(options, function(err, stats) {
    if (err) {
      return t.end(err);
    } else if (stats.hasErrors()) {
      return t.end(stats.toString());
    }

    const { assets } = stats.toJson();
    const files = assets.map(x => x.name);

    t.true(files.includes('index.html'));
    t.true(files.includes('who.html'));
    t.true(files.includes('how.html'));
    t.true(files.includes('log-in.html'));
    t.true(files.includes('sign-up.html'));
    t.true(files.includes('404.html'));

    t.true(files.includes('app.css'));
    t.true(files.includes('app.js'));

    // Test size in MB. We want to make sure this bundle was minified since we
    // are using the minify JS plugin
    const bundle = assets[files.indexOf('app.js')];
    t.true((bundle.size / 1000) < 500);

    t.end();
  });
});
