import Expo
import kakao_login
import NaverThirdPartyLogin
import React
import ReactAppDependencyProvider

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
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
      // 2. 네이버 로그인 콜백만 네이버 SDK로 — tenniscoach://thirdPartyLoginResult 또는 tenniscoach:///thirdPartyLoginResult
      let isNaverCallback = url.host == "thirdPartyLoginResult"
        || url.path.hasPrefix("/thirdPartyLoginResult")
      if isNaverCallback {
        let naverHandled = NaverThirdPartyLoginConnection.getSharedInstance().application(app, open: url, options: options)
        if naverHandled { return true }
      }
      // 3. 그 외 tenniscoach:// (비밀번호 재설정 등) → React Native Linking으로 전달
      return super.application(app, open: url, options: options)
        || RCTLinkingManager.application(app, open: url, options: options)
    }

    return super.application(app, open: url, options: options)
      || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
