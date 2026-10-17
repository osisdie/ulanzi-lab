// Shared property inspector: every <form> field with a name is saved as the key's settings.
let SETTINGS = {};
let form = null;
$UD.connect();

$UD.onConnected(() => {
  form = document.querySelector('#property-inspector');
  document.querySelector('.uspi-wrapper').classList.remove('hidden');
  form.addEventListener('input', Utils.debounce(() => {
    SETTINGS = { ...SETTINGS, ...Utils.getFormValue(form) };
    $UD.sendParamFromPlugin(SETTINGS);
  }));
  if (Object.keys(SETTINGS).length) Utils.setFormValue(SETTINGS, form);
});

const load = (m) => {
  if (m && m.param && typeof m.param === 'object') {
    SETTINGS = m.param;
    if (form) Utils.setFormValue(SETTINGS, form);
  }
};
$UD.onAdd(load);
$UD.onParamFromApp(load);
