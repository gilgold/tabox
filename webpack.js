const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const baseManifest = require("./chrome/manifest.json");
const WebpackExtensionManifestPlugin = require("webpack-extension-manifest-plugin");
const TerserPlugin = require("terser-webpack-plugin");

module.exports = (env, argv) => {
  const isProduction = argv.mode === "production";
  const isDevelopment = argv.mode === "development";

  return {
    mode: argv.mode,
    
    // Development: fast rebuilds with inline source maps
    // Production: external source maps (can be disabled for release)
    devtool: isDevelopment 
      ? 'cheap-module-source-map' 
      : (env.sourcemap !== 'false' ? 'source-map' : false),
    
    entry: {
      app: path.join(__dirname, "./static/index.js"),
    },
    
    output: {
      path: path.resolve(__dirname, "./build"),
      filename: "[name].js",
      // Use stable chunk IDs for deterministic builds
      chunkFilename: "[name].js",
      clean: true, // Clean build folder before each build
    },
    
    resolve: {
      extensions: ["*", ".js"],
    },
    
    optimization: {
      minimize: isProduction,
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            parse: {
              ecma: 2020,
            },
            compress: {
              ecma: 2020,
              comparisons: false,
              inline: 2,
              drop_console: isProduction && env.drop_console === 'true',
              drop_debugger: isProduction,
              pure_funcs: isProduction ? ['console.log'] : [],
            },
            mangle: {
              safari10: true,
            },
            output: {
              ecma: 2020,
              comments: false,
              ascii_only: true,
            },
          },
          extractComments: false, // Don't create separate LICENSE.txt files
        }),
      ],
      
      // Enable module concatenation (scope hoisting) for smaller bundles
      concatenateModules: isProduction,
      
      // Use deterministic IDs for better caching and consistent builds
      moduleIds: 'deterministic',
      chunkIds: 'deterministic',
      
      // Split vendor code into separate chunks for better caching
      splitChunks: isProduction ? {
        chunks: 'all',
        maxInitialRequests: 25,
        minSize: 20000,
        cacheGroups: {
          // Group React and related packages
          react: {
            test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            name: 'vendor-react',
            chunks: 'all',
            priority: 40,
          },
          // Group UI libraries
          ui: {
            test: /[\\/]node_modules[\\/](react-icons|react-modal|react-select|react-tooltip|react-tiny-popover|react-hot-toast|react-countdown-circle-timer|react-time-ago)[\\/]/,
            name: 'vendor-ui',
            chunks: 'all',
            priority: 30,
          },
          // Group drag-and-drop libraries
          dnd: {
            test: /[\\/]node_modules[\\/]@dnd-kit[\\/]/,
            name: 'vendor-dnd',
            chunks: 'all',
            priority: 30,
          },
          // Remaining vendor modules
          vendors: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            chunks: 'all',
            priority: 10,
          },
        },
      } : undefined,
      
      // Keep runtime chunk inline in app.js for Chrome extensions
      runtimeChunk: false,
    },
    
    // Disable performance warnings - not relevant for Chrome extensions (local loading)
    performance: {
      hints: false,
    },
    
    plugins: [
      new HtmlWebpackPlugin({
        title: "Tabox - Save and Share Tab Groups",
        meta: {
          charset: "utf-8",
          viewport: "width=device-width, initial-scale=1, shrink-to-fit=no",
          "theme-color": "#000000"
        },
        manifest: "manifest.json",
        filename: "index.html",
        template: "./static/index.html",
        hash: !isProduction, // Only add hash in development for cache busting
        minify: isProduction ? {
          removeComments: true,
          collapseWhitespace: true,
          removeRedundantAttributes: true,
          useShortDoctype: true,
          removeEmptyAttributes: true,
          removeStyleLinkTypeAttributes: true,
          keepClosingSlash: true,
          minifyJS: true,
          minifyCSS: true,
          minifyURLs: true,
        } : false,
      }),
      new CopyPlugin({
        patterns: [
          { from: "chrome/icons", to: "icons" },
          { from: "static/images", to: "images" },
          { from: "static/globals.js", to: "[name][ext]" },
          { from: "static/deferedLoading.*", to: "[name][ext]" },
          { from: "chrome/*.js", to: "[name][ext]" },
          { from: "chrome/api-keys.json", to: "[name][ext]" },
          {
            from: 'node_modules/webextension-polyfill/dist/browser-polyfill.min.*',
            to: "[name][ext]"
          }
        ]
      }),
      new WebpackExtensionManifestPlugin({
        config: {
          base: baseManifest
        }
      })
    ],
    
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: "babel-loader",
            options: {
              cacheDirectory: true, // Cache babel compilations for faster rebuilds
              cacheCompression: false, // Faster cache without compression
            }
          }
        },
        {
          test: /\.css$/,
          use: ["style-loader", "css-loader"]
        },
        {
          test: /\.(png|jpg|gif)$/i,
          type: 'asset/resource'
        }
      ]
    },
    
    // Cache for faster subsequent builds
    cache: {
      type: 'filesystem',
      buildDependencies: {
        config: [__filename],
      },
      name: isProduction ? 'production' : 'development',
    },
    
    // Stats configuration for cleaner output
    stats: isProduction ? {
      assets: true,
      chunks: false,
      modules: false,
      entrypoints: true,
      warnings: true,
      errors: true,
      errorDetails: true,
    } : 'normal',
  };
};
