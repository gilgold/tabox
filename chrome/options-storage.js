importScripts("webext-options-sync");

window.optionsStorage = new OptionsSync({
	defaults: {
		oAuthToken: ''
	},
});