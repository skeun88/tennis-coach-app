const { withDangerousMod, withAppBuildGradle, withSettingsGradle } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SETTINGS_GRADLE_SNIPPET = `
include ':react-native-purchases'
project(':react-native-purchases').projectDir = new File(rootProject.projectDir, '../node_modules/react-native-purchases/android')`;

const withRevenueCatSettingsGradle = (config) => {
  return withSettingsGradle(config, (config) => {
    if (!config.modResults.contents.includes(':react-native-purchases')) {
      config.modResults.contents += SETTINGS_GRADLE_SNIPPET;
    }
    return config;
  });
};

const withRevenueCatAppBuildGradle = (config) => {
  return withAppBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes('react-native-purchases')) {
      config.modResults.contents = config.modResults.contents.replace(
        /implementation\("com\.facebook\.react:react-android"\)/,
        `implementation("com.facebook.react:react-android")
    implementation project(':react-native-purchases')`
      );
    }
    return config;
  });
};

const withRevenueCatMainApplication = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const mainAppPath = path.join(
        config.modRequest.platformProjectRoot,
        'app/src/main/java/com/tenniscoach/app/MainApplication.kt'
      );

      if (!fs.existsSync(mainAppPath)) {
        console.warn('[withRevenueCat] MainApplication.kt not found, skipping patch');
        return config;
      }

      let contents = fs.readFileSync(mainAppPath, 'utf8');

      if (contents.includes('RNPurchasesPackage')) {
        return config;
      }

      // Add import
      contents = contents.replace(
        'import com.facebook.react.PackageList',
        'import com.facebook.react.PackageList\nimport com.revenuecat.purchases.react.RNPurchasesPackage'
      );

      // Register package
      contents = contents.replace(
        /override fun getPackages\(\): List<ReactPackage> =\s*PackageList\(this\)\.packages\.apply \{[\s\S]*?\}/,
        `override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              add(RNPurchasesPackage())
            }`
      );

      fs.writeFileSync(mainAppPath, contents, 'utf8');
      console.log('[withRevenueCat] MainApplication.kt patched successfully');
      return config;
    },
  ]);
};

const withRevenueCat = (config) => {
  config = withRevenueCatSettingsGradle(config);
  config = withRevenueCatAppBuildGradle(config);
  config = withRevenueCatMainApplication(config);
  return config;
};

module.exports = withRevenueCat;
