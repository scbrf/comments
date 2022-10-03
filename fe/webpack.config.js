const webpack = require("webpack");
const path = require("path");

module.exports = {
  entry: "./src/index.js",
  watch: true,
  output: {
    filename: "comments.js",
    path: path.resolve(__dirname, "assets"),
  },
  plugins: [
    new webpack.IgnorePlugin({
      resourceRegExp: /^\.\/locale$/,
      contextRegExp: /moment$/,
    }),
  ],
};
