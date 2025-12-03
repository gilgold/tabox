module.exports = {
    presets: [
        '@babel/preset-env',
        ['@babel/preset-react', {
            runtime: 'automatic' // Use new JSX transform for React 19
        }]
    ],
    plugins: [
        ["@babel/plugin-transform-runtime", {
          "regenerator": true
        }]
    ]
};