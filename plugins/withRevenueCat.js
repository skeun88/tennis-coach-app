const { withDangerousMod, withAppBuildGradle, withSettingsGradle, withProjectBuildGradle } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SETTINGS_GRADLE_SNIPPET = `
include ':react-native-purchases'
findProject(':react-native-purchases')?.projectDir = new File(rootProject.projectDir, '../node_modules/react-native-purchases/android')`;

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

// Inject ext block into root build.gradle so react-native-purchases
// getExtOrIntegerDefault() can resolve compileSdkVersion etc.
const withRevenueCatRootBuildGradle = (config) => {
  return withProjectBuildGradle(config, (config) => {
    const EXT_BLOCK = `
ext {
    buildToolsVersion = findProperty('android.buildToolsVersion') ?: "35.0.0"
    minSdkVersion = (findProperty('android.minSdkVersion') ?: "24").toInteger()
    compileSdkVersion = (findProperty('android.compileSdkVersion') ?: "35").toInteger()
    targetSdkVersion = (findProperty('android.targetSdkVersion') ?: "36").toInteger()
    ndkVersion = findProperty('android.ndkVersion') ?: "27.1.12297006"
    kotlinVersion = findProperty('android.kotlinVersion') ?: "2.1.20"
}`;
    if (!config.modResults.contents.includes('ext {')) {
      config.modResults.contents = config.modResults.contents.replace(
        'apply plugin: "expo-root-project"',
        EXT_BLOCK + '\n\napply plugin: "expo-root-project"'
      );
    }
    return config;
  });
};

const withRevenueCat = (config) => {
  config = withRevenueCatRootBuildGradle(config);
  config = withRevenueCatSettingsGradle(config);
  config = withRevenueCatAppBuildGradle(config);
  config = withRevenueCatMainApplication(config);
  return config;
};

module.exports = withRevenueCat;
