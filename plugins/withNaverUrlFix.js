/**
 * withNaverUrlFix
 *
 * expo prebuild 시 @react-native-seoul/naver-login 플러그인이 AppDelegate에
 * 모든 URL을 Naver SDK로 보내는 코드를 자동 생성함.
 * 이 플러그인은 그 코드를 패치해서 tenniscoach://thirdPartyLoginResult URL만
 * Naver SDK로 보내고, 나머지는 RCTLinkingManager로 전달하도록 수정함.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withNaverUrlFix = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const appDelegatePath = path.join(
        config.modRequest.platformProjectRoot,
        'Kerri',
        'AppDelegate.swift'
      );

      if (!fs.existsSync(appDelegatePath)) {
        console.warn('[withNaverUrlFix] AppDelegate.swift not found, skipping patch');
        return config;
      }

      let contents = fs.readFileSync(appDelegatePath, 'utf8');

      // Add kakao_login import if missing
      if (!contents.includes('import kakao_login')) {
        contents = contents.replace(
          'import NaverThirdPartyLogin',
          'import kakao_login\nimport NaverThirdPartyLogin'
        );
      }

      // Replace the openURL method with the correct routing logic.
      // Match any auto-generated openURL method body and replace it.
      const openURLPattern = /\/\/ Linking API\s+public override func application\(\s+_ app: UIApplication,\s+open url: URL,\s+options: \[UIApplication\.OpenURLOptionsKey: Any\] = \[:\]\s+\) -> Bool \{[\s\S]*?\n  \}/;

      const fixedOpenURL = `// Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    // 1. 카카오 로그인 콜백
    if kakao_login.RNKakaoLogins.isKakaoTalkLoginUrl(url) {
      return kakao_login.RNKakaoLogins.handleOpen(url)
    }

    if url.scheme == "tenniscoach" {
      // 2. 네이버 로그인 콜백만 네이버 SDK로 (tenniscoach://thirdPartyLoginResult)
      let isNaverCallback = url.host == "thirdPartyLoginResult"
        || url.path.hasPrefix("/thirdPartyLoginResult")
      if isNaverCallback {
        let naverHandled = NaverThirdPartyLoginConnection.getSharedInstance().application(app, open: url, options: options)
        if naverHandled { return true }
      }
      // 3. 나머지 tenniscoach:// → RCTLinkingManager (비밀번호 재설정 딥링크 등)
      return super.application(app, open: url, options: options)
        || RCTLinkingManager.application(app, open: url, options: options)
    }

    return super.application(app, open: url, options: options)
      || RCTLinkingManager.application(app, open: url, options: options)
  }`;

      if (openURLPattern.test(contents)) {
        contents = contents.replace(openURLPattern, fixedOpenURL);
        console.log('[withNaverUrlFix] AppDelegate.swift patched successfully');
      } else {
        console.warn('[withNaverUrlFix] Could not find openURL pattern to patch. AppDelegate may need manual update.');
      }

      fs.writeFileSync(appDelegatePath, contents, 'utf8');
      return config;
    },
  ]);
};

module.exports = withNaverUrlFix;
