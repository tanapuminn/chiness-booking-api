const appSettingModel = require('../models/appSettingModel');

const DEFAULT_SETTINGS = {
  key: 'site',
  projectTitle: '',
  projectSubtitle: '',
};

const formatSettings = (settings) => ({
  projectTitle: settings.projectTitle || '',
  projectSubtitle: settings.projectSubtitle || '',
});

const sendSettings = (res, settings) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.json(formatSettings(settings));
};

const getSettingsDocument = async () => {
  const settings = await appSettingModel.findOneAndUpdate(
    { key: 'site' },
    { $setOnInsert: DEFAULT_SETTINGS },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return settings;
};

const getSettings = async (req, res, next) => {
  try {
    const settings = await getSettingsDocument();
    sendSettings(res, settings);
  } catch (error) {
    next(error);
  }
};

const updateSettings = async (req, res, next) => {
  try {
    const projectTitle = String(req.body.projectTitle || '').trim();
    const projectSubtitle = String(req.body.projectSubtitle || '').trim();

    if (!projectTitle || !projectSubtitle) {
      return res.status(400).json({ message: 'projectTitle and projectSubtitle are required' });
    }

    const settings = await appSettingModel.findOneAndUpdate(
      { key: 'site' },
      { $set: { projectTitle, projectSubtitle } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    sendSettings(res, settings);
  } catch (error) {
    next(error);
  }
};

module.exports = { getSettings, updateSettings };