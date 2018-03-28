angular.module('dashboard.services.Settings', [
  'dashboard.Config',
  'dashboard.Utils',
  'ngCookies'
])

.service('SettingsService', function($cookies, Config, Utils) {
  "ngInject";

  this.saveNav = function(nav) {
    var path = Config.serverParams.cmsBaseUrl + '/settings/config/nav';
    return Utils.apiHelper('POST', path, nav);
  };
  
})

;
