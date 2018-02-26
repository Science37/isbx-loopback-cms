/**
 * isbx-loopback-cms - v0.1.3 - 2018-02-26
 * 
 *
 * Copyright (c) 2018 ISBX
 * Licensed MIT <>
 */
angular.module('dashboard', [
  'dashboard.Dashboard',
  'dashboard.Login',
  'dashboard.Register',
  'dashboard.directives',
  'dashboard.filters',
  'dashboard.services.Cache',
  'dashboard.services.Session',
  'templates-app',
  'templates-common',
  'ui.router',
  'oc.lazyLoad',
  'ngCookies',
  'ngAnimate',
  'pascalprecht.translate'
])

.config(['$locationProvider', '$stateProvider', '$urlRouterProvider', '$compileProvider', '$qProvider', '$translateProvider', 'Config', function myAppConfig($locationProvider, $stateProvider, $urlRouterProvider, $compileProvider, $qProvider, $translateProvider, Config) {
  "ngInject";

  $compileProvider.aHrefSanitizationWhitelist(/^\s*(http|https|ftp|mailto|tel|file|blob|data):/);
  $urlRouterProvider.otherwise('/login');
  if(Config.serverParams.disableRegistration) $urlRouterProvider.when('/register','/login');
  $locationProvider.html5Mode(true);
  // $qProvider.errorOnUnhandledRejections(false); //angular 1.6.1 'Possibly unhandled rejection:' issues

  //Load localized strings if available via angular-translate
  $translateProvider.useSanitizeValueStrategy('escape');
  if (Config.serverParams.translateUrl) $translateProvider.useUrlLoader(Config.serverParams.translateUrl);
  if (Config.serverParams.defaultLanguage) $translateProvider.fallbackLanguage(Config.serverParams.defaultLanguage);


  $stateProvider
    .state('public', {
      abstract: true,
      template: '<ui-view />'
    })
    .state('public.accessDenied', {
      url: '/access-denied',
      template: '<div class="no-script-warning"><h1>Access Denied</h1><p>You are not authorized to access this page.</p><p><button onclick="window.history.go(-2)">Back</button></p></div>',
      data: {
        pageTitle: 'Access Denied'
      }
    });

  $urlRouterProvider.deferIntercept(); // defer routing until custom modules are loaded
}])

.run(['$ocLazyLoad', '$rootScope', '$urlRouter', '$injector', '$translate', 'Config', function run($ocLazyLoad, $rootScope, $urlRouter, $injector, $translate, Config) {
  "ngInject";

  if (Config.serverParams.defaultLanguage) $translate.use(Config.serverParams.defaultLanguage);
  if (Config.serverParams.translateUrl) $translate.refresh();

  var modulesLoaded = false;
  if (Config.serverParams.customModules) {
    $ocLazyLoad.load(Config.serverParams.customModules)
      .then(function() {
        modulesLoaded = true;
        $rootScope.$broadcast('modulesLoaded');
        if (Array.isArray(Config.serverParams.injectOnStart)) {
          Config.serverParams.injectOnStart.forEach($injector.get);
        }
      }, function(error){console.log(error)});
  } else {
    modulesLoaded = true;
  }

  $rootScope.$on('$locationChangeSuccess', function(e) {
    if (modulesLoaded) {
      $urlRouter.sync();
    } else {
      var listener = $rootScope.$on('modulesLoaded', function() {
        $urlRouter.sync();
        listener();
      });
    }
  });

}])

.constant('constants', {
  TIMEOUT_INTERVAL: 5000,
  PUBLIC_STATE: 'public',
  LOGIN_STATE: 'public.login'
})

.controller('AppCtrl', ['$scope', '$location', '$state', '$rootScope', '$timeout', '$document', '$cookies', 'SessionService', 'CacheService', 'Config', 'constants', function AppCtrl ($scope, $location, $state, $rootScope, $timeout, $document, $cookies, SessionService, CacheService, Config, constants) {
  "ngInject";

  $rootScope.$state = $state;
  if (Config.serverParams.gaTrackingId) ga('create', Config.serverParams.gaTrackingId, 'auto');

  $rootScope.$on('$stateChangeStart', function(event, toState, toParams, fromState, fromParams) {
    var toStateName = toState.name;
    toStateName = toStateName.substr(toStateName, toStateName.indexOf('.'));

    if (!SessionService.getAuthToken() && toStateName != constants.PUBLIC_STATE) {
      var desiredState = { state: toState, params: toParams };
      CacheService.set('desiredState', desiredState);

      if (Config.serverParams.loginState) {
        $state.go(Config.serverParams.loginState); //custom login controller
      } else if (toStateName != constants.PUBLIC_STATE) {
        $state.go(constants.LOGIN_STATE);
      }
      event.preventDefault();
      return;
    }

    if(!SessionService.isAuthorized(toState, toParams)) {
      $state.go('public.accessDenied');
      event.preventDefault();
    }
    
  });

  $scope.$on('$stateChangeSuccess', function(event, toState, toParams, fromState, fromParams){
    if (angular.isDefined(toState.data.pageTitle)) {
      $scope.pageTitle = toState.data.pageTitle;
    }
  });

  $rootScope.logOut = function(){
    if(!SessionService.getAuthToken()) return;
    CacheService.reset(); //clear out caching
    SessionService.logOut()
      .then(function(result){
        if (Config.serverParams.loginState) {
          $state.go(Config.serverParams.loginState); //custom login controller
        } else {
          $state.go(constants.LOGIN_STATE);
        }
      })
      .catch(function(error){
        $state.go(constants.LOGIN_STATE);
      });
  };

  var lastPersistDate = new Date();
  $rootScope.persistSession = function() {
    $timeout.cancel($rootScope.persistId);
    if ($state.current.name.indexOf(constants.PUBLIC_STATE) > -1) {
      return; //don't timeout if on the public website
    }
    lastPersistDate = new Date();
    //limit the amount of time localStorage is written to
    if (new Date() - lastPersistDate > constants.TIMEOUT_INTERVAL) {
      if ($rootScope.checkTimeout()) {
        $cookies.put('lastActive', new Date());
      }
    } else {
      $rootScope.persistId = $timeout(function() {
        if ($rootScope.checkTimeout()) {
          $cookies.put('lastActive', new Date());
        }
      }, constants.TIMEOUT_INTERVAL);
    }
  }

  $rootScope.checkTimeout = function() {
    $timeout.cancel($rootScope.timeoutId);
    if (!$cookies.get('lastActive')) {
      console.error('Session Timedout on another window/tab');
      $state.go(constants.LOGIN_STATE);
      return false;
    }
    var lastActiveDate = new Date($cookies.get('lastActive'));
    var interval = new Date() - lastActiveDate;
    if (interval > Config.serverParams.sessionTimeout) {
      $rootScope.logOut();
      return false;
    } else {
      $rootScope.timeoutId = $timeout($rootScope.checkTimeout, constants.TIMEOUT_INTERVAL); //Wait another 5 sec to check again
      return true;
    }

  };

  //Handle Idle Timer for SessionTimeout
  if (Config.serverParams.sessionTimeout && $location.host() != 'localhost') {
    $document.on("mousemove", function() {
      //For Desktop devices
      $rootScope.persistSession();
    });
    $document.on("touchmove", function() {
      //For Mobile devices
      $rootScope.persistSession();
    });
    $document.on("keydown", function() {
      $rootScope.persistSession();
    });
  }

  }])

;


angular.module('dashboard.Alert', [
  'ui.bootstrap',
  'ui.bootstrap.modal'
])

.controller('AlertCtrl', ['$scope', '$uibModalInstance', function AlertCtrl($scope, $uibModalInstance) {
  "ngInject";

  $scope.closeAlert = function() {
    $uibModalInstance.close();
  };
  
  function init() {
    $scope.isConfirm = ($scope.alertType == 'confirm');
  }

  $scope.okAlert = function() {
    if(typeof $scope.okHandler == 'function') $scope.okHandler();
    $uibModalInstance.close();
  };

  $scope.cancelAlert = function() {
    if(typeof $scope.cancelHandler == 'function') $scope.cancelHandler();
    $uibModalInstance.close();
  };
  
  init();
}])

;

angular.module('dashboard.Dashboard', [
  'dashboard.Config',
  'dashboard.Profile',
  'dashboard.Dashboard.Model',
  'dashboard.services.Dashboard',
  'ui.router'
])

.config(['$stateProvider', function config($stateProvider) {
  "ngInject";

  $stateProvider
    .state('dashboard', {
      url: '/dashboard',
      controller: 'DashboardCtrl',
      templateUrl: 'app/dashboard/Dashboard.html',
      data: {
        pageTitle: 'Dashboard'
      }
    }).state('portal', {
      url: '/portal',
      controller: 'DashboardCtrl',
      templateUrl: 'app/dashboard/Dashboard.html',
      data: {
        pageTitle: 'Dashboard'
      }
    });
}])

.controller('DashboardCtrl', ['$scope', '$rootScope', '$state', '$stateParams', '$location', '$cookies', '$uibModal', 'Config', 'DashboardService', function DashboardCtrl($scope, $rootScope, $state, $stateParams, $location, $cookies, $uibModal, Config, DashboardService) {
  "ngInject";

  var self = this;

  this.init = function() {

    //scope functions
    $scope.toggleSideMenu = self.toggleSideMenu;
    $scope.hideSideMenu = self.hideSideMenu;
    $scope.editProfile = self.editProfile;
    $scope.logout = self.logout;

    //scope properties
    $scope.locationPath = $location.path();
    $scope.username = $cookies.get('username');
    $scope.email = $cookies.get('email');
    $scope.userId = $cookies.get('userId');
    try {
      $scope.userInfo = JSON.parse($cookies.get('session'));
      $scope.userInfo.user.roles = JSON.parse($cookies.get('roles'));
    } catch(e) {
      //Fail elegantly 
      console.error("Unable to parse $cookies.get(session)", e);
    }
    // console.log('DashboardCtrl: $scope.userInfo', $scope.userInfo);
    $scope.title = Config.serverParams.title || 'Content Management System';
    $scope.nav = DashboardService.getNavigation();

    //When navigating to the dashboard state redirect to the default nav
    if ($state.current.name == "dashboard") {
      //Navigate to default page defined in Config JSON
      if (Config.serverParams.defaultNav) {
        var defaultNav = DashboardService.getDefaultNav($scope.nav, angular.copy(Config.serverParams.defaultNav));
        if (defaultNav.state) {
          $state.go(defaultNav.state, defaultNav.params);
        } else {
          $state.go("dashboard.model.action." + defaultNav.route, defaultNav.params);
        }
      }
    }

    $scope.$watch(function() {
      return $location.path();
    }, function(){
      $scope.locationPath = $location.path();
    });

    $scope.$on('modelEditSaved', function() {
      if ($scope.modalInstance) $scope.modalInstance.close();
    });
  };

  /**
   * For responsive mobile implementation
   */
  this.toggleSideMenu = function() {
    var $dashboard = $(".dashboard");
    if ($dashboard.hasClass("show-side-menu")) {
      $dashboard.removeClass("show-side-menu");
    } else {
      $dashboard.addClass("show-side-menu");
    }
  };

  /**
   * For responsive mobile implementation
   */
  this.hideSideMenu = function() {
    $(".dashboard").removeClass("show-side-menu");
  };

  /**
   * Launches a modal dialog for editing the user's profile
   */
  this.editProfile = function($event) {
    if ($event) $event.preventDefault();
    $scope.action = {
        options: {
          model: Config.serverParams.profileModel,
          key: Config.serverParams.profileKey,
          id: $cookies.get('userId'),
          hideDelete: true
        }
    };
    $scope.modalInstance = $uibModal.open({
      templateUrl: 'app/dashboard/profile/Profile.html',
      controller: 'ProfileCtrl',
      size: "lg",
      scope: $scope
    });
  };

  /**
   * Log out
   * @param $event
   */
  this.logout = function($event) {
    $rootScope.logOut();
    if ($event) $event.preventDefault();
  };
  
  self.init();
}])

;

angular.module('dashboard.Dashboard.Model', [
  'dashboard.Dashboard.Model.Action',
  'ui.router'
])

.config(['$stateProvider', function config($stateProvider) {
  "ngInject";

  $stateProvider
    .state('dashboard.model', {
      url: '/:model',
      controller: 'DashboardModelCtrl',
      templateUrl: 'app/dashboard/model/DashboardModel.html',
      data: {
        pageTitle: 'Dashboard'
      }
    })
    ;
}])

.controller('DashboardModelCtrl', ['$rootScope', '$scope', '$stateParams', 'Config', function DashboardModelCtrl($rootScope, $scope, $stateParams, Config) {
  "ngInject";

  function init() {
    $scope.section = angular.copy(_.find($scope.nav, { path: $stateParams.model }));
  }

  init();
}])

;

angular.module('dashboard.Dashboard.Model.Action', [
  'dashboard.Dashboard.Model.Edit',
  'dashboard.Dashboard.Model.List',
  'dashboard.Dashboard.Model.Sort',
  'dashboard.Dashboard.Model.View',
  'dashboard.Dashboard.Model.Nav',
  'dashboard.Dashboard.Model.Definition',
  'ui.router'
])

.config(['$stateProvider', function config($stateProvider) {
  "ngInject";

  $stateProvider
    .state('dashboard.model.action', {
      url: '/:action',
      controller: 'DashboardModelActionCtrl',
      templateUrl: 'app/dashboard/model/DashboardModelAction.html',
      data: {
        pageTitle: 'Dashboard'
      }
    })
    ;
}])

.controller('DashboardModelActionCtrl', ['$scope', '$stateParams', function DasbhoardModelActionCtrl($scope, $stateParams) {
  "ngInject";

  function init() {
    if ($scope.section && $scope.section.subnav) {
      $scope.action = angular.copy(_.find($scope.section.subnav, { label: $stateParams.action }));
    }
  }

  init();
}])

;

angular.module('dashboard.Dashboard.Model.Definition', [
  'dashboard.Config',
  'dashboard.services.Settings',
  'ui.router',
  'ui.bootstrap.modal'
])

.config(['$stateProvider', function config($stateProvider) {
  "ngInject";

  $stateProvider
    .state('dashboard.model.action.definition', {
      url: '/definition',
      //controller: 'ModelDefinitionCtrl', /* causes controller to init twice */
      templateUrl: 'app/dashboard/model/definition/ModelDefinition.html',
      data: {
        pageTitle: 'Settings - Model Definitions'
      }
    })
    ;
}])

.controller('ModelDefinitionCtrl', ['$scope', '$timeout', '$state', '$location', '$uibModal', 'Config', 'SettingsService', function ModelDefinitionCtrl($scope, $timeout, $state, $location, $uibModal, Config, SettingsService) {
  "ngInject";

  var jsonEditor = null;
  var modifiedModels = [];
  var modalInstance = null;
  var currentModelIndex = 0;
  
  function init() {
    $scope.hideSideMenu();
    
    var models = angular.copy(Config.serverParams.models); //make a copy of the current nav to persist changes
    
    //convert models to array 
    var keys = Object.keys(models);
    for (var i in keys) {
      var key = keys[i];
      var model = models[key];
      modifiedModels.push(model);
    }

    //only display one navigation at a time so that json-editor doesn't 
    //generate DOM elements for every field in the models JSON
    models = filterModels(currentModelIndex); 
    console.log(JSON.stringify(models, null, '  '));
    var element = document.getElementById("models");
    var options = {
        theme: "bootstrap3",
        iconlib: "fontawesome4",
        layout: "tree",
        startval: models,
        disable_properties: false,
        disable_edit_json: true,
        disable_delete_all: true,
        disable_delete_last: true,
        schema: {
          type: "array", 
          title: "Models",
          format: "tabs",
          options: {
            disable_collapse: true
          },
          items: {
            title: "Model",
            type: "object",
            headerTemplate: "{{self.name}}",
            id: "model",
            properties: {
            }
          }
          
        }
    };
    
    jsonEditor = new JSONEditor(element, options);
    jsonEditor.on('ready',function() {
      //jsonEditor is ready
    });
    
    jsonEditor.on("tabclick", function(params) {
      //Store the current section info in case it was modified
      var model = jsonEditor.getEditor("root."+currentModelIndex);
      //console.log("section.getValue(); = " + JSON.stringify(section.getValue(), null, '  '));
      modifiedModels[currentModelIndex] = model.getValue();
      
      //Load the section info
      currentModelIndex = params.index;
      model = jsonEditor.getEditor("root."+currentModelIndex);
      if (model) model.setValue(modifiedModels[currentModelIndex]);
      
    });
    
  }
  
  function filterModels(currentModelndex) {
    var models = angular.copy(modifiedModels);
    for (var i = 0; i < models.length; i++) {
      var model = models[i];
      delete model.options;
      delete model.properties;
      delete model.display;
      delete model.acls;
      if (currentModelIndex != i) {
      }
    } 
    return models;
  }
  

  $scope.clickSave = function() {
    //Display Save Modal Popup
//    $scope.alertTitle = "Saving...";
//    $scope.alertMessage = "Saving navigation settings";
//    $scope.allowAlertClose = false;
//    modalInstance = $modal.open({
//      templateUrl: 'app/dashboard/alert/Alert.html',
//      controller: 'AlertCtrl',
//      size: "sm",
//      scope: $scope
//    });
//
//    //Store the current section info in case it was modified
//    var section = jsonEditor.getEditor("root."+currentNavIndex);
//    modifiedNav[currentNavIndex] = section.getValue();
//
//    //Save modifiedNav to config.js 
//    //console.log(JSON.stringify(modifiedNav, null, '  '));
//    SettingsService.saveNav(modifiedNav)
//      .then(function(response) {
//        //Saved Successfully
//        $scope.alertMessage = "Saved Successful!";
//        $scope.allowAlertClose = true;
//        
//      }, function(error) {
//        if (typeof error === 'object' && error.message) {
//          alert(error.message);
//        } else if (typeof error === 'object' && error.error && error.error.message) {
//            alert(error.error.message);
//        } else if (typeof error === 'object') {
//          alert(JSON.stringify(error));
//        } else {
//          alert(error);
//        }
//      });
  };
  
  //init();
}])

;

angular.module('dashboard.Dashboard.Model.Edit', [
  'dashboard.Dashboard.Model.Edit.SaveDialog',
  'dashboard.Config',
  'dashboard.directives.ModelField',
  'dashboard.services.Cache',
  'dashboard.services.GeneralModel',
  'dashboard.services.FileUpload',
  'dashboard.filters.locale',
  'ui.router',
  'ui.bootstrap',
  'ui.bootstrap.datepicker',
  'ui.bootstrap.modal',
  'ngCookies'  
])

.config(['$stateProvider', function config($stateProvider) {
  "ngInject";

  $stateProvider
    .state('dashboard.model.action.edit', {
      url: '/edit/:id',
      //controller: 'ModelEditCtrl', /* causes controller to init twice */
      templateUrl: 'app/dashboard/model/edit/ModelEdit.html',
      data: {
        pageTitle: 'Edit'
      }
    })
    ;
}])

.constant('modelEditConstants', {
  'keys': {
      'save': 'button.save',
      'delete':'button.delete',
      'confirmMessage':'button.delete.confirm'
  },
  'defaults': {
      'save': 'Save',
      'delete': 'Delete',
      'confirmMessage': 'Are you sure you want to delete this record?'
  }
})

.controller('ModelEditCtrl', ['$rootScope', '$scope', '$cookies', '$location', '$stateParams', '$state', '$window', '$uibModal', '$filter', 'Config', 'GeneralModelService', 'FileUploadService', 'CacheService', 'modelEditConstants', '$translate', function ModelEditCtrl($rootScope, $scope, $cookies, $location, $stateParams, $state, $window, $uibModal, $filter, Config, GeneralModelService, FileUploadService, CacheService, modelEditConstants, $translate) {
  "ngInject";

  var modalInstance = null;
  function init() {
    $scope.hideSideMenu();
    if ($window.ga) $window.ga('send', 'pageview', { page: $location.path() });

    if (!$scope.action) $scope.action = {};
    if (!$scope.action.options) $scope.action.options = { model: $stateParams.model, key: $stateParams.key };

    $scope.model = angular.copy(Config.serverParams.models[$scope.action.options.model]);

    //Make Key field readonly
    if ($scope.action.options.key) {
      var key = $scope.action.options.key;
      if (!$scope.model.properties[key].display) $scope.model.properties[key].display = {};
      $scope.model.properties[key].display.readonly = true;
    }

    //Get locale
    var languageCode = $translate.use();//retrieve currently used language key
    $scope.locale = $filter('iso-639-1')(languageCode); //convert ISO 639-2 to 639-1 for datetime

    _.forEach($scope.model.properties, function(property) {
      if (!property.display) property.display = {};
      if (!property.display.options) property.display.options = {};
      if($scope.action.options.readonly) {//Check if readonly view
        property.display.readonly = true;
      }
      if (typeof property.type === 'string') {
        switch (property.type.toLowerCase()) {
            case 'date':
            case 'datetime':
              property.display.options.locale = $scope.locale;
              break;
        }
      }
    });

    $scope.isLoading = true;
    $scope.data = {};

    //Check to see if there's any passed in values from the referring page
    if ($scope.action.options.data) {
      var keys = Object.keys($scope.action.options.data);
      for (var i in keys) {
        var key = keys[i];
        $scope.data[key] = $scope.action.options.data[key]; //only occurs for new records (this gets replaced when editing a record)
      }
    }

    //Loop through fields and check for forced default fields
    GeneralModelService.checkDefaultValues($scope.model, $scope.data);
    
    //Check to see if editing model
    var id = null;
    if ($stateParams.id && $stateParams.id > 0) id = $stateParams.id;
    if ($scope.action.options.id && $scope.action.options.id > 0) id = $scope.action.options.id;
    if (id) {
      $scope.isEdit = true;
      $scope.modelDisplay = null; //reset model display to prevent caching
      GeneralModelService.get($scope.model.plural, id)
      .then(function(response) {
        if (!response) return;  //in case http request was cancelled
        $scope.data = response;
        layoutModelDisplay();
        $scope.isLoading = false;
      });
    } else {
      layoutModelDisplay();
      $scope.isEdit = false;
      $scope.isLoading = false;
    }


    $translate([modelEditConstants.keys.save, modelEditConstants.keys.delete, modelEditConstants.keys.confirmMessage])
      .then(function (translated) { // If translation fails or errors, use default strings
        $scope.saveButtonText = (translated[modelEditConstants.keys.save]==modelEditConstants.keys.save) ? modelEditConstants.defaults.save:translated[modelEditConstants.keys.save];
        $scope.deleteButtonText = (translated[modelEditConstants.keys.delete]==modelEditConstants.keys.delete) ? modelEditConstants.defaults.delete:translated[modelEditConstants.keys.delete];
        $scope.deleteDialogText = (translated[modelEditConstants.keys.confirmMessage]==modelEditConstants.keys.confirmMessage) ? modelEditConstants.defaults.confirmMessage:translated[modelEditConstants.keys.confirmMessage];
      }, function(transId) {
        $scope.saveButtonText = modelEditConstants.defaults.save;
        $scope.deleteButtonText = modelEditConstants.defaults.delete;
        $scope.deleteDialogText = modelEditConstants.defaults.confirmMessage;
      });
    //for deprecation
    $scope.$on('saveModel', function() { $scope.clickSaveModel($scope.data); });
    $scope.$on('deleteModel', function(event, formParams) {
      $scope.clickDeleteModel($scope.data, formParams);
    });

    $scope.$on('onModelSave', function() { $scope.clickSaveModel($scope.data); });
    $scope.$on('onModelDelete', function(event, formParams) {
      $scope.clickDeleteModel($scope.data, formParams);
    });

    $scope.$watchCollection('data', function(newData, oldData) {
      if ($scope.isLoading) return;
      //trigger change event only after model has been loaded and actual change was detected
      $scope.$emit('onModelChange', newData, oldData);
    });
    $scope.$on('onModelFieldReferenceChange', function(event, key, newValue, oldValue) {
      if (!$scope.data.hasOwnProperty(key) || !_.isEqual(newValue, oldValue)) {
        $scope.data[key] = newValue;
      }
    });
  }

  function layoutModelDisplay() {
    //Check if $scope.model.display is defined displaying the order of fields defined in the loopback model json
    $scope.modelDisplay = $scope.model.display;
    if ($scope.action.options.display) $scope.modelDisplay = $scope.model[$scope.action.options.display];
    if (!$scope.modelDisplay || $scope.modelDisplay.length == 0) {
      $scope.modelDisplay = [];
      var keys = Object.keys( $scope.model.properties);
      for (var i in keys) {
        var key = keys[i];
        $scope.modelDisplay.push(key);
        if (!$scope.data[key]) $scope.data[key] = null;
      }
    }

    $scope.$emit('onModelLoad', { data: $scope.data });
  }


  /**
   * Performs call to loopback to save the model data
   */
  function save(callback) {
    var id = $scope.data[$scope.action.options.key];
    GeneralModelService.saveWithFiles($scope.model.name, id, $scope.data)
      .then(function(response) {
        if (modalInstance) modalInstance.close();
        $rootScope.$broadcast('modelEditSaved');
        if (callback) callback(response);
      },
      displayError,
      displayStatus);
  }

  function displayError(error) {
    $rootScope.$broadcast('modelEditSaveFailed', { error: error });
    if (_.isPlainObject(error)) {
      if (typeof error.translate === 'string' && error.translate.length > 0) {
        var msg = $translate.instant(error.translate);
        if (msg === error.translate) msg = error.message; //if no translation then display english message
        alert(msg);
      } else if (error.code || error.message) {
        if (error.code === 'ER_DUP_ENTRY') error.message = "There was a duplicate entry found. Please make sure the entry is unique.";
        alert(error.message);
      } else if (error.error) {
        displayError(error.error)
      } else {
        alert(angular.toJson(error))
      }
    } else {
      alert(error);
    }
    if (modalInstance) modalInstance.close();
  }

  function displayStatus(status) {
    if (_.isPlainObject(status)) {
      if (status.translate) {
        var statusMsg = $translate.instant(status.translate, status.params);
        $scope.status = (statusMsg === status.translate) ? status.message : statusMsg;
      } else if (status.message) $scope.status = status.message;
      if (status.progress) $scope.progress = status.progress;
    }
  }


  /**
   * Check to see if any file upload functionality exist and upload files first then call to save the model data
   */
  $scope.clickSaveModel = function(data) {
    displayStatus({message:"Saving", translate:"cms.status.saving", progress:0.0});
    modalInstance = $uibModal.open({
      templateUrl: 'app/dashboard/model/edit/ModelEditSaveDialog.html',
      controller: 'ModelEditSaveDialogCtrl',
      scope: $scope
    });
    save(function(response){
      CacheService.clear($scope.action.options.model);
      if($scope.action.options && $scope.action.options.returnAfterEdit) {
        $window.history.back();
      } else {
        //reload data
        if (!$scope.section) {
          //No section identified, so likely not called from main navigation via config.json
          //Instead likely called from Modal Popup
          if (modalInstance) modalInstance.close();
        } else {
          $state.go($scope.section.state ? $scope.section.state : "dashboard.model.action.edit", { model: $scope.section.path, action: $scope.action.label, id:response[$scope.action.options.key] });
        }
      }
    });
  };
  
  $scope.clickDeleteModel = function(data, formParams) {
    $scope.deleteDialogText = (formParams && formParams.deleteDialogText) ? formParams.deleteDialogText : $scope.deleteDialogText;
    if (!confirm($scope.deleteDialogText)) return;
    var id = data[$scope.action.options.key];
    if ($scope.model.options && $scope.model.options.softDeleteProperty) {
      //Soft Delete
      $scope.data[$scope.model.options.softDeleteProperty] = true;
      save(function() {
        CacheService.clear($scope.action.options.model);
        $window.history.back();
      });
    } else {
      //Hard Delete
      GeneralModelService.remove($scope.model.plural, id)
      .then(function(response) {
        $rootScope.$broadcast('modelDeleted');
        CacheService.clear($scope.action.options.model);
        $window.history.back();
      }, function(error) {
        if (typeof error === 'object' && error.message) {
          alert(error.message);
        } else if (typeof error === 'object' && error.error && error.error.message) {
            alert(error.error.message);
        } else if (typeof error === 'object') {
          alert(JSON.stringify(error));
        } else {
          alert(error);
        }
      });
    }
  };
  
  /**
   * Checks if the user access to edit the field for this Model
   */
  $scope.hasPermission = function(key) {
    var displayInfo = null;
    if (typeof key === "object") {
      displayInfo = key;
    } else {
      var property = $scope.model.properties[key];
      displayInfo = property.display;
    }

    if (!displayInfo) {
      return true;
    }

    if (displayInfo.askIf) {
      var properties = Object.keys(displayInfo.askIf);
      for (var i in properties) {
        var property = properties[i];
        if ($scope.data[property] != displayInfo.askIf[property]) {
          return false; //don't display if doesn't match criteria
        }
      }
    }

    if (!displayInfo.roles) {
      return true; //no roles specified so grant permission
    }

    if (!$cookies.get('roles')) {
      return false; //user has no role access
    }
    
    var userRoles = JSON.parse($cookies.get('roles'));
    for (var i in userRoles) {
      var role = userRoles[i];
      if (displayInfo.roles.indexOf(role.name) > -1) {
        return true;
      }
    }
    return false;
  };
  
  init();
}])

;

angular.module('dashboard.Dashboard.Model.Edit.SaveDialog', [
  'ui.bootstrap',
  'ui.bootstrap.progressbar',
  'ui.bootstrap.modal'
])

.controller('ModelEditSaveDialogCtrl', ['$scope', '$translate', function ModelEditCtrl($scope, $translate) {
  "ngInject";

  function init() {
    $scope.statusLabel = 'Status';
    $translate("cms.status").then(function(translated) {
      if (typeof translated == 'string' && translated.length > 0 && translated !== 'cms.status')
        $scope.statusLabel = translated;
    }, function(e) {
      console.log('Failed to translate cms.status', e);
    });
  }
  
  init();
}])

;

angular.module('dashboard.Dashboard.Model.List', [
  'dashboard.Dashboard.Model.Edit.SaveDialog',                                                
  'dashboard.Config',
  'dashboard.services.Cache',
  'dashboard.services.GeneralModel',
  'dashboard.directives.ModelFieldReference',
  'ui.router',
  'ngCookies',
  'ngGrid',
  'googlechart'
])

.config(['$stateProvider', function config($stateProvider) {
  "ngInject";

  $stateProvider
    .state('dashboard.model.action.list', {
      url: '/list',
      templateUrl: 'app/dashboard/model/list/ModelList.html',
      data: {
        pageTitle: 'List'
      }
    })
    ;
}])

.controller('ModelListCtrl', ['$scope', '$cookies', '$timeout', '$state', '$location', '$window', '$uibModal', 'Config', 'GeneralModelService', 'CacheService', function ModelListCtrl($scope, $cookies, $timeout, $state, $location, $window, $uibModal, Config, GeneralModelService, CacheService) {
  "ngInject";

  var isFirstLoad = true;
  var modalInstance = null;
  var selectedItems = [];

  function init() {
    $scope.isLoading = true;
    $scope.moment = moment;
    $scope.columnCount = 0;
    $scope.list = [];
    $scope.selected = [];
    $scope.columns = [];
    $scope.listTemplateUrl = '';
    $scope.totalServerItems = 0;
    $scope.isEditing = false;
    $scope.searchFields = $scope.action.options.searchFields;
    if ($scope.action.options.sort) {
        //Custom Sort Override
        $scope.sortInfo = $scope.action.options.sort;
    } else {
        //Use default sort by key
        $scope.sortInfo = { fields: [$scope.action.options.key], directions: ["ASC"] };
    }
    $scope.filterOptions = {
        filterText: "",
        useExternalFilter: (typeof $scope.action.options.useExternalFilter === "boolean") ? $scope.action.options.useExternalFilter:false
    };
    $scope.pagingOptions = {
        //Follow ng-grid pagination model
        pageSizes: ['25', '50', '100', '250', '500'],
        pageSize: $scope.action.options.pageSize ? $scope.action.options.pageSize : '25',
        currentPage: 1 //1-based index
    };

    if ($scope.action.options.pageSize) {
       var pageSize = $scope.action.options.pageSize.toString();
       var index = $scope.pagingOptions.pageSizes.indexOf(pageSize);
       $scope.pagingOptions.pageSizes = $scope.pagingOptions.pageSizes.slice(0, index + 1);
     }
    if (!$scope.sortInfo) $scope.sortInfo = {};
    if (!$scope.sortInfo.columns) $scope.sortInfo.columns = [];

    $scope.gridOptions = {
        data: "list",
        enableColumnResize: true,
        enableRowSelection: typeof $scope.action.options.enableRowSelection === "boolean" ? $scope.action.options.enableRowSelection : true,
        multiSelect: false,
        enablePaging: true,
        useExternalSorting: true,
        showSelectionCheckbox: false,
        sortInfo: $scope.sortInfo,
        showFooter: true,
        showFilter: $scope.action.options.showFilter,
        headerRowHeight: 44,
        footerRowHeight: 44,
        totalServerItems: "totalServerItems",
        pagingOptions: $scope.pagingOptions,
        filterOptions: $scope.filterOptions,
        selectedItems: $scope.selected,
        rowHeight: $scope.action.options.rowHeight ? $scope.action.options.rowHeight : 44
    };
    //For Mobile
    $scope.hideSideMenu();
    if ($window.ga) $window.ga('send', 'pageview', { page: $location.path() });

    //Make a column visible
    $scope.$on('updateColumnVisibility', function (event, column, visibility) {
      updateColumnVisibility(column, visibility);
    })

    //Check if Chart needs to be displayed
    $scope.gridContainerTopMargin = 0;
    if ($scope.action.options.chart) {
      $scope.gridContainerTopMarginMax = $scope.action.options.chart.height + 60; //used for scrolling effect 
      $scope.gridContainerTopMargin = $scope.gridContainerTopMarginMax;
      processChart();
    }
    
    window.ngGrid.i18n['en'].ngTotalItemsLabel = "Total Records: ";
    window.ngGrid.i18n['en'].ngPageSizeLabel = "Show: ";
    
    //Load Column Definition
    $scope.columns = getColumnDefinition();
    $scope.gridOptions.columnDefs = "columns"; //tells ng-grid to watch $scope.columns for changes
    
    //Check if Editable
    //NOTE: $scope.action.options.disableAdd determines if you can add a record or not
    if ($scope.action.options.editable) {
      $scope.gridOptions.enableCellEdit = true;
      $scope.gridOptions.enableCellEditOnFocus = false;
      $scope.gridOptions.enableCellSelection = true;
      $scope.gridOptions.enableRowSelection = false;
    }

    //Setup Data Query
    if (!$scope.action.options.params) $scope.action.options.params = {};
    if ($scope.action.options.model) $scope.model = Config.serverParams.models[$scope.action.options.model];
    if ($scope.action.options.api) {
      //options contains api path with possible variables to replace
      $scope.apiPath = $scope.action.options.api;
    } else if ($scope.action.options.model) {
      //Simple model list query
      $scope.apiPath = $scope.model.plural;
    }
    $scope.origApiPath = $scope.apiPath;
    addQueryStringParams();
    $scope.getTotalServerItems();
    
    $timeout(function() {
      //Custom styling override for ng-grid
      $(".ngFooterPanel select").addClass("form-control");
      $(".ngFooterPanel button").addClass("btn btn-default");
    });

    //On Browser resize determine if optional columns should be hidden
    $scope.$grid = $(".grid");
    angular.element($window).bind("resize", function() {
    	processWindowSize();
    });
    
    //Check if editing then show Save/Cancel buttons
    $scope.$on('ngGridEventStartCellEdit', function () {
      startEdit();
    });
    
    $scope.$on('ModelListLoadItems', function($event, options) {
      if (options && options.resetPaging) $scope.pagingOptions.currentPage = 1;
      $scope.getTotalServerItems(); //make sure to get the total server items and then reload data
    });

    if (/(iPad|iPhone|iPod|Android)/g.test( navigator.userAgent ) || $scope.action.options.flexibleHeight)  {
      //For mobile let the page scroll rather just the ng-grid (Also see mouse binding details below for mobile mobile tweaks)
      $scope.gridOptions.plugins = [new ngGridFlexibleHeightPlugin()];
    }

    if ($scope.action.options.allowCSVExport) {
      if (!$scope.gridOptions.plugins) $scope.gridOptions.plugins = [];
      $scope.gridOptions.plugins.push(new ngGridCsvExportPlugin());
    }

    //Load Strings
    if (Config.serverParams.strings) {
      $scope.cancelButtonText = Config.serverParams.strings.cancelButton;
      $scope.saveButtonText = Config.serverParams.strings.saveButton;
    }

    $scope.$on('RemoveSelectedItems', function () {
       removeSelectedItems();
     })
  }

  //Change visibility of a column 
  function updateColumnVisibility(column, visibility) {
    var index = _.findIndex($scope.columns, {field: column});
    if (index >= 0) {
      $scope.columns[index].visible = visibility;
    }
  }

  $scope.clickSelectAll = function () {
    for (var i in $scope.list) {
      if ($scope.list[i].isChecked && !$scope.action.selectAll) {
        $scope.list[i].isChecked = false;
        var index = selectedItems.indexOf($scope.list[i]);
        selectedItems.splice(index, 1);
      } else if ($scope.action.selectAll && selectedItems.indexOf($scope.list[i]) < 0) {
        $scope.list[i].isChecked = true;
        selectedItems.push($scope.list[i]);
      }
    }
    $scope.$emit("SelectedModelList", { list: selectedItems });
   };

  $scope.clickItemCheckbox = function (item) {
    var selectedItem = selectedItems.indexOf(item) > -1;
    if (item.isChecked && !selectedItem) {
      selectedItems.push(item);
    } else if (selectedItem) {
      var index = selectedItems.indexOf(item);
      selectedItems.splice(index, 1);
      if (selectedItems.length == 0) $scope.action.selectAll = false;
    }
    $scope.$emit("SelectedModelList", { list: selectedItems });
  };
  
  function removeSelectedItems() {
    for (var i in selectedItems) {
      selectedItems[i].isChecked = false;
    }
    selectedItems = [];
    $scope.action.selectAll = false;
    $scope.$emit("SelectedModelList", { list: selectedItems });
  };

  function getColumnDefinition() {
	//Setup Columns in Grid
	var columnRef = $scope.action.options.columnRef;
	var columns = $scope.action.options.columns;
	if (columnRef && typeof columnRef === 'object' && columnRef.label) {
	  if (columnRef.path) {
		//reference to another main-nav's sub-nav's columns :)
		var section = _.find(Config.serverParams.nav, { path: columnRef.path });
		var subnav = _.find(section.subnav, { label: columnRef.label });
		columns = subnav.options.columns;
	  } else {
		//reference to another subnav's columns in the same section
		var subnav = _.find($scope.section.subnav, { label: columnRef.label });
		columns = subnav.options.columns;
	        
	  }
	}
	//Check column role access
	columns = angular.copy(columns); //make copy
	if (columns && $cookies.get('roles')) {
      var roles = JSON.parse($cookies.get('roles'));
      if (roles) {
        for (var i = 0; i < columns.length; i++) {
          var column = columns[i];
          if (column.roles) {
            var isRoleFound = false;
            for (var r in roles) {
              var role = roles[r];
              if (column.roles.indexOf(role.name) > -1) {
                isRoleFound = true;
                break; //exit current for loop
              }
            }
            //role was not found so hide column
            if (!isRoleFound) {
              columns.splice(i, 1);
              i--;
            }
            
          }
        }
      }
	}
	return columns; //assign the column definitions
  }
  
  /**
   * Handles hiding optional columns identified in the config.json colunn definition
   */
  function processWindowSize() {
	var $grid = $scope.$grid;
  	var windowWidth = $window.innerWidth;
	var averageColumnWidth = windowWidth / $scope.columnCount;
	//console.log("windowWidth = " + windowWidth + "; columnCount = "+$scope.columnCount+"; averageColumnWidth = " + averageColumnWidth);
	if (averageColumnWidth < 90 && !$grid.hasClass("hide-optional")) {
		$grid.addClass("hide-optional");
		//Remove optional columns
		$scope.columns = $scope.columns.filter(function(column) { return !column.optional; });
		//$scope.$digest();
	} else if (averageColumnWidth >= 90 && $grid.hasClass("hide-optional")) {
		$grid.removeClass("hide-optional");
		//Display All Columns
		$scope.columns = $scope.columns = getColumnDefinition();
	}
	  
  }

  /**
   * URLs can contain loopback.io filter query string parameters to filter the list.
   * This is useful when linking to a sub-list (i.e. Viewing entries for a particular contest)
   */
  function addQueryStringParams() {
    var queryStringParams = $location.search();
    $scope.queryStringParams = queryStringParams; //so nggrid cell templates can have access
    $scope.apiPath = $scope.origApiPath;
    var keys = Object.keys(queryStringParams);
    for (var i in keys) {
      var key = keys[i];
      
      //Add filter params from querystring
      $scope.action.options.params[key] = queryStringParams[key];
      
      if ($scope.apiPath) {
        //Swap out any variables needed in API Path
        $scope.apiPath = $scope.apiPath.replace("{"+key+"}", queryStringParams[key]);
      }
    }
    
    //Look for session variables in $scope.apiPath
    try {
      var session = JSON.parse($cookies.get('session')); //needed for eval() below
      var searchString = "{session.";
      var startPos = $scope.apiPath.indexOf(searchString);
      while (startPos > -1) {
        var endPos = $scope.apiPath.indexOf("}", startPos);
        if (endPos == -1) {
          console.error("ModelList session parsing malformed for $scope.apiPath");
          break;
        }
        var sessionKey = $scope.apiPath.substring(startPos+1, endPos);
        $scope.apiPath = $scope.apiPath.slice(0, startPos) + eval(sessionKey) + $scope.apiPath.slice(endPos+1);
        startPos = $scope.apiPath.indexOf(searchString);
      }
    } catch(e) {
      console.error(e);
    }
    
    //Gets the filter description if available for display
    var filterDescription = queryStringParams["filterDescription"];
    $scope.filterDescription = filterDescription ? filterDescription : $scope.action.label; 

    //Check if paging and sorting exists in querystring
    if (queryStringParams.pageSize) $scope.pagingOptions.pageSize = queryStringParams.pageSize;
    else if ($scope.action.options.pageSize) $scope.pagingOptions.pageSize = $scope.action.options.pageSize.toString();
    if (queryStringParams.currentPage) $scope.pagingOptions.currentPage = parseInt(queryStringParams.currentPage);
    if (queryStringParams.sortInfo) {
      try {
        var sortInfo = JSON.parse(queryStringParams.sortInfo);
        _.extend($scope.sortInfo, sortInfo);
      } catch(e) {
        console.warn("There are errors with the querystring param 'pagingOptions'");
      }
    }

    //Check if search is in querystring
    if (queryStringParams.search) $scope.filterOptions.filterText = queryStringParams.search; 
  }
  
  function setupPagination() {
    //make a copy of config params
    var params = angular.copy($scope.action.options.params);

    if (params && params.filter && params.filter.length > 0) {
      //use of filter JSON string
      try {
        var filter = JSON.parse(params.filter);
        filter.limit = parseInt($scope.pagingOptions.pageSize);
        filter.skip = ($scope.pagingOptions.currentPage-1) * parseInt($scope.pagingOptions.pageSize);
        if ($scope.sortInfo.fields.length > 0) {
          filter.order = "";
          for (var i in $scope.sortInfo.fields) {
            var field = $scope.sortInfo.fields[i];
            var direction = $scope.sortInfo.directions[i];
            if (!direction) direction = "ASC";
            if (parseInt(i) > 0) filter.order += ", ";
            filter.order += field + " " + direction;
          }
        }
        params.filter = JSON.stringify(filter);
      } catch (e) {
        console.error(e);
        alert("Error with list filter. Please contact administrator for assistance.");
      }
    } else {
      //use of loopback.io querystring syntax
      params = _.extend(params, {
        'filter[limit]': parseInt($scope.pagingOptions.pageSize),
        'filter[skip]': ($scope.pagingOptions.currentPage-1) * parseInt($scope.pagingOptions.pageSize)
      });

      if ($scope.sortInfo.fields.length > 0) {
        var sortOrder = "";
        for (var i in $scope.sortInfo.fields) {
          var field = $scope.sortInfo.fields[i];
          var direction = $scope.sortInfo.directions[i];
          if (!direction) direction = "ASC";
          if (parseInt(i) > 0) sortOrder += ", ";
          sortOrder += field + " " + direction;
        }

        params = _.extend(params, { 
          'filter[order]': sortOrder
        });
      }
      //TODO: this needs to be improved at it does not properly work with an and operator in where clause
      if ($scope.searchFields && $scope.gridOptions.filterOptions.filterText) {
        // convert to json to work around query string limitation
        params = GeneralModelService.queryStringParamsToJSON(params);
        var filterText = $scope.gridOptions.filterOptions.filterText;
        if(typeof params.filter.where == "object") {
          var where = angular.copy(params.filter.where);
          params.filter.where = {and:[]};
          _.forEach(where, function(v,k) {
            var item = {};
            item[k] = v;
            params.filter.where.and.push(item);
          });
          var orFilter = {or:[]};
          angular.forEach($scope.searchFields, function(field, idx) {
              var key = '['+field+'][like]';
              var searchFilter = _.set({}, key, '%'+filterText+'%');
              orFilter.or.push(searchFilter);
          });
          params.filter.where.and.push(orFilter);
        } else {
          angular.forEach($scope.searchFields, function (field, idx) {
            var key = 'filter[where][or][' + idx + '][' + field + '][like]';
            params = _.set(params, key, '%' + filterText + '%');
          });
        }
      }
    }
    
    //TODO: Figure out a better way to preserve state; the following
    $location.search("pageSize", $scope.pagingOptions.pageSize);
    $location.search("currentPage", $scope.pagingOptions.currentPage);
    var sortInfo = angular.copy($scope.sortInfo); //make a copy of sortInfo so that the watch statement doesn't get called
    delete sortInfo.columns; //cleanup sortInfo to declutter querystring
    $location.search("sortInfo", JSON.stringify(sortInfo));
    $location.replace(); //replaces current history state rather then create new one when chaging querystring
    addQueryStringParams();
    return params;
  }
  
  $scope.getTotalServerItems = function() {
    $scope.isLoading = true;
    $scope.list = [];
    $scope.totalServerItems = 0;
    var params = setupPagination();
    GeneralModelService.count($scope.apiPath, params)
    .then(function(response) {
      if (!response) return; //in case http request was cancelled
      //Check if response is an array or object
      if (typeof response === 'string') {
        $scope.totalServerItems = response;
      } else {
        if (response instanceof Array && response.length > 0) response = response[0];
        var keys = Object.keys(response);
        if (!response.count && keys.length > 0) {
          response.count = response[keys[0]]; //grab first key as the count if count property doesn't exist
        }
        $scope.totalServerItems = response.count;
      }
      if(parseInt($scope.totalServerItems) > 0)
        $scope.loadItems(params);
      else {
        $scope.isLoading = false;
        $scope.loadAttempted = true;
      }
    },
    function(error) {
        $scope.isLoading = false;
        $scope.errorMessage = 'There was an error while loading...';
        console.error(error);
    });
  };

  $scope.loadItems = function(params) {
    $scope.isLoading = true;
    $scope.list = [];
    $scope.$emit("ModelListLoadItemsLoading");
    if(!params) params = setupPagination();
      //Rudimentary Caching (could use something more robust here)
      var cacheKey = CacheService.getKeyForAction($scope.action,params);
      if(!$scope.filterOptions.useExternalFilter) {
        if(CacheService.get(cacheKey)) {
          //Instantly load from previous cached results for immediate response
          try {
            $scope.list = CacheService.get(cacheKey); //load from cache
            $scope.columnCount = $scope.list.length > 0 ? Object.keys($scope.list[0]).length : 0;
            processWindowSize(); //on first load check window size to determine if optional columns should be displayed
          } catch(e) {
            console.warn("ModelList Cache is corupt for key = " + cacheKey);
          }
        }
      }

    //Always query for the latest list even if the cache has previously cached results so that any updates
    //from the data source is refreshed

    GeneralModelService.list($scope.apiPath, params).then(
      function(response) {
        if (!response) return; //in case http request was cancelled
        if( $scope.action.options.resultField !== undefined
          && response[$scope.action.options.resultField] !== undefined )
          $scope.list = response[$scope.action.options.resultField];
        else
          $scope.list = response;
        $scope.columnCount = $scope.list.length > 0 ? Object.keys($scope.list[0]).length : 0;
        if(!$scope.filterOptions.useExternalFilter) CacheService.set(cacheKey, $scope.list);
        $scope.$emit("ModelListLoadItemsLoaded");
        isFirstLoad = false;
        $scope.isLoading = false;
        $scope.loadAttempted = true;
        processWindowSize(); //on first load check window size to determine if optional columns should be displayed
      },
      function(error) {
        $scope.isLoading = false;
        $scope.errorMessage = 'There was an error while loading...';
        console.error(error);
      })
  };
  
  /**
   * Return if the dynamic button should be displayed
   */
  $scope.hasButtonPermission = function(button) {
    if (!button.roles) return true;
    if (!$cookies.get('roles')) return false; //user does not have any roles
    var roles = JSON.parse($cookies.get('roles'));
    for (var i in roles) {
      var role = roles[i];
      if (button.roles.indexOf(role.name) > -1) {
        return true;
      }
    }
    return false;
  };
  
  /**
   * Dynamic buttons from config.json
   */
  $scope.clickListButton = function(button) {
    if (button.click) {
      //Custom Module implements button.click function in $scope
      eval("$scope." + button.click);
    } else if (button.route) {
      //Navigate to a specific custom route
      //$scope.action.options = angular.copy(button.options);
      if (button.options) {
        if (button.options.model) $scope.action.options.model = button.options.model;
        if (button.options.key) $scope.action.options.key = button.options.key;
        if (button.options.display) $scope.action.options.display = button.options.display;
        if (button.returnAfterEdit) $scope.action.options.returnAfterEdit = button.returnAfterEdit;
        if (button.options.data) {
          var keys = Object.keys(button.options.data);
          for (var i in keys) {
            var key = keys[i];
            var value = button.options.data[key];
            if (value.lastIndexOf("{") > -1) {
              value = value.substring(value.lastIndexOf("{")+1,value.lastIndexOf("}"));
              value = $scope.queryStringParams[value];
            }
            if (!$scope.action.options.data) $scope.action.options.data = {}; 
            $scope.action.options.data[key] = value;
          }
        }
      }
      $state.go("dashboard.model.action." + button.route);
    } else if (button.path && button.label) {
      //Navigate to an existing navigation path/label combo in the same section
      var section = _.find(Config.serverParams.nav, { path: button.path });
      var action = _.find(section.subnav, {label: button.label});
      $state.go("dashboard.model.action." + action.route, { model: section.path, action: action.label });
    }
  };
 
  /**
   * When config.json specifies editable = true
   */
  $scope.clickAdd = function() {
	//Add a blank row to the bottom of the Form List
	  if ($scope.list && $scope.list.length > 0) {
		  //Prevent creating a new row if last row is not populated
		  //var keys = Object.keys($scope.list[$scope.list.length-1]);
		  //if (keys.length == 0) return;
	  }
	  $scope.list.push({});
	  startEdit();
  };
  
  $scope.clickSaveEdit = function() {
    //Make sure there's an oldList to compare with $scope.list
    if ($scope.oldList) {
      //determine what has changed from the old list
      var deltaList = [];
      for (var i in $scope.list) {
        var newRow = $scope.list[i];
        var oldRow = $scope.oldList[i];
        //make sure newRow is not empty
        if (!newRow || (typeof newRow == 'object' && Object.keys(newRow).length == 0) || newRow.length == 0) {
          continue;
        }
               
        if (!oldRow || JSON.stringify(newRow) != JSON.stringify(oldRow)) {

          /*
           * We decided to remove any ability to upsert from model list
           * due to issues with model reference field not being able propagate
           * up the information needed. 
           */
          /*
          if ($scope.model && $scope.model.options.relations) {
            //check to see if a relationship was set to null; to prevent upsert of old relationship
            var rowKeys = Object.keys(newRow);
            for (var i in rowKeys) {
              var key = rowKeys[i];
              if (newRow[key] == null) {
                //Found field set to null; check if in a relationship
                var relationshipKeys = Object.keys($scope.model.options.relations);
                for (var k in relationshipKeys) {
                  var relationshipKey = relationshipKeys[k];
                  var relationship = $scope.model.options.relations[relationshipKey];
                  var foreignKey = relationship.foreignKey;
                  if (foreignKey && foreignKey == key && relationship.model) {
                    if (newRow[relationship.model]) {
                      //delete model reference
                      delete newRow[relationship.model];
                    }
                  }
                }
              }
            }
          }
          */
          
          //Remove all relationships to prevent upserting on the server side
          var rowKeys = Object.keys(newRow);
          for (var i in rowKeys) {
            var key = rowKeys[i];
            if (newRow[key] && typeof newRow[key] === 'object') {
              delete newRow[key];
            }
          }
          
          //insert defaults as specified in config.json
          if ($scope.action.options.defaults) {
            var keys = Object.keys($scope.action.options.defaults);
            for (var i in keys) {
              var key = keys[i];
              var property = $scope.action.options.defaults[key];
              if (property && (property.foreceDefaultOnSave || !newRow[key])) {
                //set the default value (i.e. lastUpdated or lastUpdatedBy)
                if (property["default"]) {
                  newRow[key] = property["default"];
                } else if (property.evalDefault) {
                  newRow[key] = eval(property.evalDefault);
                }
              }
            }
          }
          
          //check if all required fields are filled in
          if ($scope.action.options.columns) {
            for (var i in $scope.action.options.columns) {
              var column = $scope.action.options.columns[i];
              if (column.required && !newRow[column.field]) {
                alert("Please fill in all required fields: " + column.displayName);
                return;
              }
            }
            
          }
          
          deltaList.push(newRow);
        }
      }
      
      //console.log(JSON.stringify(deltaList, null, '  '));
      //return;

      
      //Save deltaList
      var recordIndex = 0;
      $scope.status = "Saving...";
      $scope.progress = 0.0;
      modalInstance = $uibModal.open({
        templateUrl: 'app/dashboard/model/edit/ModelEditSaveDialog.html',
        controller: 'ModelEditSaveDialogCtrl',
        scope: $scope
      });
      
      var saveRecord = function(record, callback) {
        var id = record[$scope.action.options.key];
        GeneralModelService.save($scope.action.options.model, id, record)
        .then(function(response) {
          callback();
        }, function(error) {
          if (typeof error === 'object' && error.message) {
            alert(error.message);
          } else if (typeof error === 'object' && error.error && error.error.message) {
              alert(error.error.message);
          } else if (typeof error === 'object' && error.code) {
            switch (error.code) {
              case "ER_DUP_ENTRY": alert("There was a duplicate entry found. Please make sure the entry is unique."); break; 
            }
          } else if (typeof error === 'object') {
            alert(JSON.stringify(error));
          } else {
            alert(error);
          }
          callback();
        });            
      };
      
      var saveNextRecord = function() {
        if (recordIndex >= deltaList.length) {
          //finished saving all data
          $scope.status = "Saved Successful";
          if (modalInstance) modalInstance.close();
          $scope.loadItems(); //refresh data after saving
          endEdit();
          return;
        }
        $scope.status = "Saving " + (recordIndex+1) + " of " + deltaList.length;
        $scope.progress = (recordIndex+1) / deltaList.length;
        var record = deltaList[recordIndex];
        saveRecord(record, function() {
          recordIndex++;
          saveNextRecord();
        });
      };
      saveNextRecord();

    }
  };
  
  $scope.clickCancelEdit = function() {
    if (confirm("Are you sure you want can cancel all changes?")) {
      endEdit();
    }
  };

  $scope.deleteRowWithMessage = function(row, msg) {
    if (msg) {
      if (confirm(msg)) $scope.deleteRow(row, true);
      return;
    }
    $scope.deleteRow(row);
  };
  
  $scope.deleteRow = function(row, bypassPrompt) {
    if (!$scope.model || !$scope.model.plural) {
      console.error("$scope.model or $scope.model.plural not found!");
      return;
    }
    if (bypassPrompt || confirm("Are you sure you want to delete this item?")) {
      var id = row.entity[$scope.action.options.key];
      if (!id) {
        //Record doesn't have an id so must be a record that has not been created yet
        $scope.list.splice(row.rowIndex, 1);
      } else {
        if ($scope.model.options && $scope.model.options.softDeleteProperty) {
          startEdit();
          row.entity[$scope.model.options.softDeleteProperty] = true; //soft delete
          $scope.clickSaveEdit();
        } else {
          GeneralModelService.remove($scope.model.plural, id)
          .then(function(response) {
            $scope.list.splice(row.rowIndex, 1); //don't reload all the data as you could be editing while deleting
          }, function(error) {
            if (typeof error === 'object' && error.message) {
              alert(error.message);
            } else if (typeof error === 'object' && error.error && error.error.message) {
                alert(error.error.message);
            } else if (typeof error === 'object') {
              alert(JSON.stringify(error));
            } else {
              alert(error);
            }
          });
          
        }
      }
    }
  };
  
  $scope.$watch("selected", function(newVal, oldVal) {
    if (newVal !== oldVal && newVal.length > 0 && !$scope.action.options.editable) {
      if ($scope.action.options.selectedState) {
        $state.go($scope.action.options.selectedState.stateName || "dashboard.model.action.edit", { model: $scope.action.options.selectedState.stateModel || $scope.section.path, key: $scope.action.options.key, action: $scope.action.options.selectedState.stateAction || $scope.action.label, id: newVal[0][$scope.action.options.selectedState.stateId || $scope.action.options.key] });
      } else {
        $state.go("dashboard.model.action.edit", { model: $scope.section.path, key: $scope.action.options.key, action: $scope.action.label, id: newVal[0][$scope.action.options.key] });
      }
    }    
  }, true);
  
  $scope.$watch('pagingOptions', function (newVal, oldVal) {
    if (newVal.currentPage != oldVal.currentPage || newVal.pageSize != oldVal.pageSize) {
      $scope.pagingOptions.pageSize = $scope.pagingOptions.pageSize.toString();
      $scope.loadItems();
    }
  }, true);

  $scope.$watch('gridOptions.$gridScope.filterText', _.debounce(function (newVal, oldVal) {
    if(newVal != oldVal) {
      $scope.$apply(function () {
        $scope.pagingOptions.currentPage = 1;
        $scope.filterOptions.filterText = newVal;
        $scope.getTotalServerItems();
      });
    }
  },250), true);

  $scope.$watch('sortInfo', function (newVal, oldVal) {
    //Check isFirstLoad so that this watch statement does not get called when the page loads for the first time
    if (!isFirstLoad && newVal !== oldVal) {
      $scope.loadItems();
    }
  }, true);

  //Wait till ngGrid is loaded and then add scroll events
  var ngGridUnWatch = $scope.$watch('gridOptions.ngGrid', function() {
    if (!$scope.gridOptions.ngGrid) return;
    var $viewport = $scope.gridOptions.ngGrid.$viewport;
    ngGridUnWatch(); //remove watch on ngGrid
    $footerPanel = $(".ngFooterPanel");
    $listContainer = $(".grid-container.list");
    
    var rebuildTimeout = null;
    var rebuildGrid = function() {
      //Used in a timer to speed up refresh
      $scope.gridOptions.$gridServices.DomUtilityService.RebuildGrid(
          $scope.gridOptions.$gridScope, 
          $scope.gridOptions.ngGrid);
      
    };
    
    var handleScrollEvent = function(event) {
      var direction = event.originalEvent.detail ? -event.originalEvent.detail : event.originalEvent.wheelDelta/4;
      var scrollY = $viewport.scrollTop();
      
      if (direction < 0) {
        //scrolling down
        var scrollY = $viewport.scrollTop();
        if (scrollY == 0) scrollY = -direction;
        if ($scope.gridContainerTopMargin-scrollY > 0) {
          $scope.gridContainerTopMargin -= scrollY;
          $viewport.height($viewport.height() + scrollY);
          $viewport.scrollTop(0);
        } else {
          $viewport.height($viewport.height() + $scope.gridContainerTopMargin);
          $scope.gridContainerTopMargin = 0;
        }
        if ($scope.gridOptions.$gridServices) {
          //prevent viewport glitch
          clearTimeout(rebuildTimeout); //timer to speed up refresh
          rebuildTimeout = setTimeout(rebuildGrid, 30);
        }
      } else if (direction > 0) {
        //scrolling up
        if (scrollY == 0 && $scope.gridContainerTopMargin < $scope.gridContainerTopMarginMax) {
          scrollY = direction;//$($window).scrollTop();
          $scope.gridContainerTopMargin += scrollY ;
          $viewport.height($viewport.height() - scrollY);
        } else if (scrollY == 0) {
          $scope.gridContainerTopMargin = $scope.gridContainerTopMarginMax;
          $viewport.height($footerPanel.offset().top-$viewport.offset().top);
          
        }
      }
      $scope.$digest(); //Make sure to refresh UI
      
    }

    //For Mobile let entire page scroll
    if (/(iPad|iPhone|iPod|Android)/g.test( navigator.userAgent ) || $scope.action.options.flexibleHeight)  {
      $(".model-list .grid-container").addClass("flexible");
      $(".model-list .grid").css({ bottom: "auto" });
      $(".model-list .ngFooterPanel").css({position: "static", bottom: "auto"});
      //$scope.gridOptions.plugins = [new ngGridFlexibleHeightPlugin()];
    }

    //Bind Mouse Wheel
    if ($scope.action.options.chart) {
      //Only bind when chart is displayed (bug: unable to resize columns widths because of handleScrollEvent())
      angular.element($window).bind("mousewheel", handleScrollEvent);
      angular.element($window).bind("DOMMouseScroll", handleScrollEvent); //Firefox
    }
    
    //Bind search filter input box if exists to maintain state when back button pressed
    $(".search .ngColMenu input").on("keyup", function() {
      //console.log("filter text change: " + $(this).val());
      $location.search("search", $(this).val());
      $location.replace(); //replaces current history state rather then create new one when changing querystring
    });
  });
 
  
  function processChart() {
    if ($scope.action.options.chart.api) {
      //Load chart data from API Call
      GeneralModelService.list($scope.action.options.chart.api, {})
      .then(function(response) {
        //console.log("chart data: " + JSON.stringify(response, null,'  '));
         
        $scope.chart = $scope.action.options.chart; //make to sure make this assignment only after data is fetched (otherwise angular-google-chart can error)

        //Assign the data
        $scope.chart.data = response;

        //Basic formatting overrides
        if (!$scope.chart.options) $scope.chart.options = {};
        if (!$scope.chart.options.vAxis)  $scope.chart.options.vAxis = {};
        if (!$scope.chart.options.hAxis)  $scope.chart.options.hAxis = {};
        if (!$scope.chart.options.hAxis.textStyle) $scope.chart.options.hAxis.textStyle = {};
        if (!$scope.chart.options.vAxis.textStyle) $scope.chart.options.vAxis.textStyle = {};
        if (!$scope.chart.options.vAxis.gridlines) $scope.chart.options.vAxis.gridlines = {};
        if (!$scope.chart.options.hAxis.textStyle.fontSize) $scope.chart.options.hAxis.textStyle.fontSize = 11;
        if (!$scope.chart.options.vAxis.textStyle.fontSize) $scope.chart.options.vAxis.textStyle.fontSize = 11;
        if (!$scope.chart.options.hAxis.textStyle.color) $scope.chart.options.hAxis.textStyle.color = "#999";
        if (!$scope.chart.options.vAxis.textStyle.color) $scope.chart.options.vAxis.textStyle.color = "#999";
        if (!$scope.chart.options.vAxis.baselineColor) $scope.chart.options.vAxis.baselineColor = "#999";
        if (!$scope.chart.options.hAxis.baselineColor) $scope.chart.options.hAxis.baselineColor = "#999";
        if (!$scope.chart.options.vAxis.gridlines.color) $scope.chart.options.vAxis.gridlines.color = "#eee";
        if (!$scope.chart.options.hAxis.gridlines.color) $scope.chart.options.hAxis.gridlines.color = "#eee";

      });
    }
  }
  
  /**
   * When the user clicks to add a row or edits a cell
   * turn list into edit mode allowing to save or cancel changes
   */
  function startEdit() {
    if (!$scope.isEditing) {
      //track existing data so that when saving can get deltas
      $scope.oldList = angular.copy($scope.list); 
      $scope.isEditing = true;
    }
  }
  
  /**
   * User either saved or cancelled edit mode so reload data
   * and hide save/cancel buttons
   */
  function endEdit() {
    if ($scope.isEditing) {
      $scope.isEditing = false;
      $scope.oldList = undefined; //clear out any old data
      $scope.loadItems();
    }
    
  }
  
  init();

}])

.filter('encodeURIComponent', function() {
    return window.encodeURIComponent;
})

;

angular.module('dashboard.Dashboard.Model.Nav', [
  'dashboard.Config',
  'dashboard.services.Settings',
  'ui.router',
  'ui.bootstrap.modal'
])

.config(['$stateProvider', function config($stateProvider) {
  "ngInject";

  $stateProvider
    .state('dashboard.model.action.nav', {
      url: '/config',
      //controller: 'ModelNavCtrl', /* causes controller to init twice */
      templateUrl: 'app/dashboard/model/nav/ModelNav.html',
      data: {
        pageTitle: 'Settings - Navigation'
      }
    })
    ;
}])

.controller('ModelNavCtrl', ['$scope', '$timeout', '$state', '$location', '$uibModal', 'Config', 'SettingsService', function ModelNavCtrl($scope, $timeout, $state, $location, $uibModal, Config, SettingsService) {
  "ngInject";

  var jsonEditor = null;
  var modifiedNav = null;
  var modalInstance = null;
  var currentNavIndex = 0;
  
  function init() {
    $scope.hideSideMenu();
    
    modifiedNav = angular.copy(Config.serverParams.nav); //make a copy of the current nav to persist changes

    //only display one navigation at a time so that json-editor doesn't 
    //generate DOM elements for every field in the navigation JSON
    var nav = filterNav(currentNavIndex); 
    
    var element = document.getElementById("navigation");
    var options = {
        theme: "bootstrap3",
        iconlib: "fontawesome4",
        layout: "tree",
        startval: nav,
        disable_properties: false,
        disable_edit_json: true,
        disable_delete_all: true,
        disable_delete_last: true,
        schema: {
          type: "array", 
          title: "Navigation",
          format: "tabs",
          options: {
            disable_collapse: true
          },
          items: {
            title: "Section",
            type: "object",
            headerTemplate: "{{self.label}}",
            id: "item",
            properties: {
              label: { title: "Label", type: "string", required: true },
              path: { title: "Path", type: "string", required: true },
              icon: { title: "Icon", type: "string", required: true },
              subnav: {
                title: "Sub-Navigation",
                type: "array",
                required: true,
                items: {
                  title: "Sub Nav",
                  headerTemplate: "{{self.label}}",
                  type: "object",
                  options: {
                    collapsed: true,
                    disable_properties: false
                  },
                  properties: {
                    label: { title: "Label", type: "string", required: true },
                    className: { title: "ClassName", type: "string", required: false },
                    route: { title: "Route", type: "string", enum: ["list", "sort", "edit", "nav", "definition"], required: true },
                    options: { 
                        type: "object",
                        options: {
                          disable_properties: false
                        },
                        properties: {
                          api: { tite: "API", type: "string" },
                          eval: { tite: "eval", type: "string" },
                          model: { title: "Model", type: "string" },
                          key: { title: "Key", type: "string" },
                          rowHeight: { title: "Row Height", type: "integer" },
                          sortField: { title: "Sort Field", type: "string" },
                          title: { title: "Title Field", description: "Field name to display when sorting", type: "string" },
                          params: {
                            type: "object",
                            options: {
                              collapsed: true
                            },
                            properties: {
                              filter: { title: "Filter", type: "string", format: "json" }
                            }
                          },
                          columnRef: {
                            title: "Column Reference",
                            //description: "Reference the columns of another subnav",
                            type: "object",
                            options: {
                              collapsed: true,
                              disable_properties: false
                            },
                            properties: {
                              path: {
                                title: "Section Path",
                                type: "string"
                              },
                              label: {
                                title: "Subnav Label",
                                type: "string"
                              }
                              
                            }
                            
                          },
                          columns: {
                            title: "Columns",
                            type: "array",
                            items: {
                              title: "column",
                              type: "object",
                              headerTemplate: "{{self.displayName}}",
                              options: {
                                collapsed: true,
                                disable_properties: false
                              },
                              properties: {
                                field: { title: "Field", type: "string", required: true },
                                displayName: { title: "Display Name", type: "string", required: true },
                                width: { title: "Width", type: "number" },
                                headerClass: { title: "Header Class", type: "string" },
                                cellClass: { title: "Cell Class", type: "string" },
                                cellTemplate: { title: "Cell Template", type: "string", format: "html" },
                                cellFilter: { title: "Cell Filter", type: "string" },
                                minWidth: { type: "string" },
                                maxWidth: { type: "string" },
                                sortable: { title: "Sortable", type: "string" },
                                resizable: { title: "Resizable", type: "string" }
                              },
                              defaultProperties: ["field", "displayName"]
                            }
                          }
                        },
                        defaultProperties: []
                    }
                  }
                }
              },
              defaultSubNavIndex: {
                title: "Default Sub Nav",
                type: "string",
                watch: {
                  subnav: "item.subnav"
                },
                enumSource: [{
                  source: "subnav",
                  title: "{{item.label}}",
                  value: "{{i}}"
                }]
                
              }
              
            }

          }
          
        }
    };
    
    jsonEditor = new JSONEditor(element, options);
    jsonEditor.on('ready',function() {
      //jsonEditor is ready
    });

    jsonEditor.on('moveup',function(params) {
      //console.log("editor moveup params.row.parent.key = " +params.row.parent.key);
      if (params.row.parent.key == "root") {
        //Section moved up
        var temp = modifiedNav[currentNavIndex-1];
        modifiedNav[currentNavIndex-1] =  modifiedNav[currentNavIndex];
        modifiedNav[currentNavIndex] = temp;
        currentNavIndex--;
        console.log("currentNavIndex = " + currentNavIndex);
      }
    });
    
    jsonEditor.on('movedown',function(params) {
      //console.log("editor movedown params.row.parent.key = " +params.row.parent.key);
      if (params.row.parent.key == "root") {
        //Section moved up
        var temp = modifiedNav[currentNavIndex+1];
        modifiedNav[currentNavIndex+1] =  modifiedNav[currentNavIndex];
        modifiedNav[currentNavIndex] = temp;
        currentNavIndex++;
        console.log("currentNavIndex = " + currentNavIndex);
      }
    });

    jsonEditor.on("tabclick", function(params) {
      //Store the current section info in case it was modified
      var section = jsonEditor.getEditor("root."+currentNavIndex);
      //console.log("section.getValue(); = " + JSON.stringify(section.getValue(), null, '  '));
      modifiedNav[currentNavIndex] = section.getValue();
      
      //Load the section info
      currentNavIndex = params.index;
      section = jsonEditor.getEditor("root."+currentNavIndex);
      if (section) section.setValue(modifiedNav[currentNavIndex]);
      
    });
    
  }
  
  function filterNav(currentNavIndex) {
    var nav = angular.copy(modifiedNav);
    for (var i = 0; i < nav.length; i++) {
      var section = nav[i];
      if (currentNavIndex != i) {
        delete section.subnav;
      }
    } 
    return nav;
  }
  

  $scope.clickSave = function() {
    //Display Save Modal Popup
    $scope.alertTitle = "Saving...";
    $scope.alertMessage = "Saving navigation settings";
    $scope.allowAlertClose = false;
    modalInstance = $uibModal.open({
      templateUrl: 'app/dashboard/alert/Alert.html',
      controller: 'AlertCtrl',
      size: "sm",
      scope: $scope
    });

    //Store the current section info in case it was modified
    var section = jsonEditor.getEditor("root."+currentNavIndex);
    modifiedNav[currentNavIndex] = section.getValue();

    //Save modifiedNav to config.js 
    console.log(JSON.stringify(modifiedNav, null, '  '));
    SettingsService.saveNav(modifiedNav)
      .then(function(response) {
        //Saved Successfully
        $scope.alertMessage = "Saved Successful!";
        $scope.allowAlertClose = true;
        
      }, function(error) {
        if (typeof error === 'object' && error.message) {
          alert(error.message);
        } else if (typeof error === 'object' && error.error && error.error.message) {
            alert(error.error.message);
        } else if (typeof error === 'object') {
          alert(JSON.stringify(error));
        } else {
          alert(error);
        }
      });
  };
  
  init();
}])

;

angular.module('dashboard.Dashboard.Model.Sort', [
  'dashboard.Config',
  'dashboard.services.GeneralModel',
  'dashboard.Alert',
  'ui.router',
  'ui.sortable',
  'ui.bootstrap.modal'
])

.config(['$stateProvider', function config($stateProvider) {
  "ngInject";

  $stateProvider
    .state('dashboard.model.action.sort', {
      url: '/sort',
      //controller: 'ModelSortCtrl', /* causes controller to init twice */
      templateUrl: 'app/dashboard/model/sort/ModelSort.html',
      data: {
        pageTitle: 'Sort'
      }
    })
    ;
}])

.controller('ModelSortCtrl', ['$scope', '$timeout', '$state', '$uibModal', '$window', 'Config', 'GeneralModelService', '$location', function ModelListCtrl($scope, $timeout, $state, $uibModal, $window, Config, GeneralModelService, $location) {
  "ngInject";

  $scope.list = [];
  var modalInstance = null;
  
  function init() {
    $scope.hideSideMenu();
    if ($window.ga) $window.ga('send', 'pageview', { page: $location.path() });

    if (!$scope.action.options.params) $scope.action.options.params = {};
    $scope.model = Config.serverParams.models[$scope.action.options.model];
    $scope.title = $scope.action.options.title ? $scope.action.options.title : $scope.action.options.key;
    $scope.loadItems();
  }


  $scope.loadItems = function() {
    if (!$scope.action.options.params) $scope.action.options.params = {};
    var params = $scope.action.options.params;
    params["filter[order]"] = $scope.action.options.sortField + " DESC";

    if ($scope.action.options.api) {
      //options contains api path with possible variables to replace
      $scope.apiPath = $scope.action.options.api;
    } else if ($scope.action.options.model) {
      //Simple model list query
      $scope.apiPath = $scope.model.plural;
    }

    GeneralModelService.list($scope.apiPath, params)
      .then(function(response) {
        if (!response) return;  //in case http request was cancelled
        //Do a sort here in case API call didn't sort (seems to be an issue with loopback's relationship queries via custom API parameters
        $scope.list = response.sort(function(a,b) {
          if (a[$scope.action.options.sortField] < b[$scope.action.options.sortField]) {
            return 1;
          }
          if (a[$scope.action.options.sortField] > b[$scope.action.options.sortField]) {
            return -1;
          }
          // a must be equal to b
          return 0;

        });
      });
  };

  $scope.moveUp = function(item) {
    var from = $scope.list.indexOf(item);
    if (from == 0) return;
    var to = from-1;
    $scope.list.splice(to, 0, $scope.list.splice(from, 1)[0]);
  };

  $scope.moveDown = function(item) {
    var from = $scope.list.indexOf(item);
    if (from == $scope.list.length-1) return;
    var to = from+1;
    $scope.list.splice(to, 0, $scope.list.splice(from, 1)[0]);
    
  };

  $scope.edit = function(item) {
    if ($scope.action.options.onEdit) {
      $scope.action.options.onEdit(item[$scope.action.options.key]);
    } else {
      $state.go("dashboard.model.action.edit", { model: $scope.section.path, action: $scope.action.label, id: item[$scope.action.options.key] });
    }
  };
  
  $scope.saveSort = function() {

    //Display Save Modal Popup
    $scope.alertTitle = "Saving...";
    $scope.alertMessage = "Saving new sort order";
    $scope.allowAlertClose = false;
    modalInstance = $uibModal.open({
      templateUrl: 'app/dashboard/alert/Alert.html',
      controller: 'AlertCtrl',
      size: "sm",
      scope: $scope
    });
    
    //Get the new sort order into an array of ids
    var newOrder = [];
    for (var i in $scope.list) {
      var item = $scope.list[i];
      var id = item[$scope.action.options.key];
      newOrder.unshift(id);
      
    }
    //console.log(JSON.stringify(newOrder));
    
    //Call CMS API to save new order
    GeneralModelService.sort($scope.action.options.model, $scope.action.options.key, $scope.action.options.sortField, newOrder)
    .then(function(response) {
      $scope.alertMessage = "Saved Successful!";
      $scope.allowAlertClose = true;
    }, function(error) {
      if (typeof error === 'object' && error.message) {
        alert(error.message);
      } else if (typeof error === 'object' && error.error && error.error.message) {
          alert(error.error.message);
      } else if (typeof error === 'object') {
        alert(JSON.stringify(error));
      } else {
        alert(error);
      }
    });
  };
  
  init();
}])

;

angular.module('dashboard.Dashboard.Model.View', [
  'dashboard.Config',
  'dashboard.directives.ModelField',
  'dashboard.services.GeneralModel',
  'ui.router'
])

.config(['$stateProvider', function config($stateProvider) {
  "ngInject";

  $stateProvider
    .state('dashboard.model.action.view', {
      url: '/view/:id',
      controller: 'ModelViewCtrl',
      templateUrl: 'app/dashboard/model/view/ModelView.html',
      data: {
        pageTitle: 'View'
      }
    })
    ;
}])

.controller('ModelViewCtrl', ['$scope', '$stateParams', 'Config', 'GeneralModelService', function ModelViewCtrl($scope, $stateParams, Config, GeneralModelService) {
  "ngInject";

  function init() {
    GeneralModelService.get($scope.model.model, $stateParams.id)
      .then(function(response) {
        $scope.data = response;
      });
  }
  
  init();
}])

;

angular.module('dashboard.Profile', [
  'ui.bootstrap',
  'ui.bootstrap.modal',
  'dashboard.Dashboard.Model.Edit'
])

.controller('ProfileCtrl', ['$scope', '$translate', function ProfileCtrl($scope, $translate) {
  
  function init() {
    $translate('user_profile.title').then(function(translated) {
        $scope.modalTitle = translated;
      }, function() { // gracefully fallback to a default value if no override provided
        $scope.modalTitle = 'User Profile';
      }
    );
  }
  
  init();
}])

;

angular.module('dashboard.Login', [
  'dashboard.Config',
  'dashboard.services.Cache',
  'dashboard.services.Session',
  'ui.router'
])

.config(['$stateProvider', function config($stateProvider) {
  "ngInject";

  $stateProvider
    .state('public.login', {
      url: '/login',
      controller: 'LoginCtrl',
      templateUrl: 'app/login/Login.html',
      data: {
        pageTitle: 'Login'
      }
    });
}])

.controller('LoginCtrl', ['$scope', '$state', '$window', 'Config', 'SessionService', 'CacheService', function LoginCtrl($scope, $state, $window, Config, SessionService, CacheService) {
  "ngInject";

  var self = this;

  this.init = function() {
    $scope.login = {};
    $scope.clickLogin = self.clickLogin;
  };

  this.clickLogin = function() {
    SessionService.logIn($scope.login.email, $scope.login.password)
      .then(function(response) {
        var desiredState = CacheService.get('desiredState');
        CacheService.reset(); //clear out all previous cache when login
        if (desiredState) {
          $state.go(desiredState.state.name, desiredState.params);
        } else {
          $state.go('dashboard');
        }
      })
      .catch(function(response) {
        if (response && response[0] && response[0].error && response[0].error.message) {
          alert(response[0].error.message);
        } else {
          alert("Invalid login.");
        }
      });
  };
  
  self.init();
}])

;

angular.module('dashboard.Register', [
  'dashboard.Config',
  'dashboard.services.Session',
  'dashboard.services.User',
  'ui.router'
])

.config(['$stateProvider', function config($stateProvider) {
  "ngInject";

  $stateProvider
    .state('public.register', {
      url: '/register',
      controller: 'RegisterCtrl',
      templateUrl: 'app/Register/Register.html',
      data: {
        pageTitle: 'Register'
      }
    });
}])

.controller('RegisterCtrl', ['$scope', 'Config', 'SessionService', 'UserService', function RegisterCtrl($scope, Config, SessionService, UserService) {
  "ngInject";

  $scope.login = {};

  function init() {
  }

  $scope.register = function() {
    UserService.register($scope.login.email, $scope.login.password)
      .then(function(response) {
        SessionService.logIn($scope.login.email, $scope.login.password).
          then(function(response) {
            $state.go('dashboard');
          })
          .catch(function(response) {
            alert("Error registering");
          });
      })
      .catch(function(response) {
        alert("Error registering");
      });
  }
  
  init();
}])

;


angular.module('dashboard.Config', [
])

.constant('Config', {
  apiBaseUrl: window.config.apiBaseUrl || '/api/',
  serverParams: window.config
});

angular.module('dashboard.directive.DateTimePicker', [
])

.directive('dateTimePicker', ['$rootScope', function ($rootScope) {
  "ngInject";

  return {
      require: '?ngModel',
      restrict: 'AE',
      scope: {
        control: '=',
        format: '@',
        ngFormat: '=ngFormat',
        ngTimeZone: '=ngTimeZone',
        defaultDate: '@',
        viewMode: '@',
        ngViewMode: '=ngViewMode',
        horizontal: '@',
        locale: '@',
        maxDate: '@',
        minDate: '@',
        onChange: '=',
        dataKey: '@',
      },
      link: function (scope, elem, attrs, ngModel) {

        //If no static attribute then use dynamic angular attributes
        if (!scope.format) scope.format = scope.ngFormat;
        if (!scope.viewMode) scope.viewMode = scope.ngViewMode;

        if (scope.format && scope.format.indexOf('DD-MMM-YYYY') > -1 && scope.locale === 'es') {
          //Hack to fix spanish date parsing via Spanish for DD-MMM-YYYY format as
          //Spanish uses period abbreviation for MMM
          scope.format = scope.format.replace('DD-MMM-', 'DD MMM ');
        }

        ngModel.$formatters.push(function(value) {
          //Format the passed in date
          if (!scope.format) scope.format = scope.ngFormat;
          if (!value) return;
          var date = moment(value);
          if (scope.ngTimeZone && date.tz) date = date.tz(scope.ngTimeZone); //NOTE: requires moment-timezone
          return date.format(scope.format);
        });
        
        scope.defaultDate = (scope.defaultDate && typeof scope.defaultDate === 'string') ? scope.defaultDate.replace(/"/g, '') : scope.defaultDate; //remove quotes

        //Bind the Element
        var options = {
          format: scope.format,
          useCurrent: false,
          locale: scope.locale,
          defaultDate: scope.defaultDate ? moment(scope.defaultDate).toDate() : undefined,
          viewMode: scope.viewMode,
          widgetPositioning: { horizontal: scope.horizontal ? scope.horizontal : 'auto' }
        }
        if (scope.minDate) options.minDate = scope.minDate;
        if (scope.maxDate) options.maxDate = scope.maxDate;
        elem.datetimepicker(options);

        //For companion button to launch the popup
        if (!scope.control) scope.control = {};
        scope.control.show = function() {
          elem.focus();
        };

        //On Blur update the ng-model
        elem.on('blur', function () {
          if (!scope.format) scope.format = scope.ngFormat;
          if (scope.locale) moment.locale(scope.locale);
          var dateValue = moment(elem.val(), scope.format);
          if (dateValue.isValid()) {
            ngModel.$setViewValue(dateValue);
          } else {
            ngModel.$setViewValue(null);
          }
          if (scope.onChange) {
            scope.onChange({key: scope.dataKey})
          }
        });
      }
    };
}]);

angular.module('dashboard.directives', [
]);

angular.module('dashboard.directives.ModelField', [
  'dashboard.directives.ModelFieldImage',
  'dashboard.directives.ModelFieldVideo',
  'dashboard.directives.ModelFieldFile',
  'dashboard.directives.ModelFieldReference',
  'dashboard.directives.ModelFieldReferenceSort',
  'dashboard.directives.ModelFieldList',
  'dashboard.directives.ModelFieldWYSIWYG',
  'dashboard.directives.ModelFieldCanvas',
  'dashboard.directives.ModelFieldLocation',
  'dashboard.directives.ModelFieldPointsOfInterest',
  'dashboard.directives.ModelFieldApiMultiSelect',
  'dashboard.directives.ModelFieldMultiSelect',
  'dashboard.directives.ModelFieldNumber',
  'dashboard.directive.DateTimePicker',
  'ngCookies',
  'ngSlider',
  'ngSignaturePad',
  'cwill747.phonenumber',
  'monospaced.elastic'
])

.directive('modelFieldView', ['$compile', function($compile) {
  "ngInject";

  function getTemplate(type) {
    var template = '';
    switch(type) {
      default:
        template = '<b>{{ field.label }}</b>: {{ data[field.name] }}';
    }
    return template;
  }
  return {
    restrict: 'E',
    scope: {
      key: '=key',
      model: '=model',
      data: '=ngModel'
    },
    link: function(scope, element, attrs) {
        element.html(getTemplate(scope.field.type)).show();
        $compile(element.contents())(scope);
    }
  };
}])

.directive('modelFieldEdit', ['$compile', function($compile) {
  "ngInject";

  function getTemplate(type, scope) {
    var template = '';
    switch(type) {
      case 'reference':
        // depends on directive modelFieldReferenceEdit
        template = '<label class="col-sm-2 control-label">{{ display.label || key | translate }}:</label> \
          <div class="col-sm-10"> \
            <div class="error-message" ng-if="display.error.length > 0">{{ display.error }}</div>\
            <model-field-reference-edit key="key" property="property" options="display.options" model-data="data" ng-model="data[key]" class="field" ng-required="{{ model.properties[key].required || property.display.required }}" ng-disabled="display.readonly" ng-blur="ngEditReason({key: key})" /> \
            <div class="model-field-description" ng-if="display.description">{{ display.description | translate }}</div>\
            <div class="model-field-edit-reason" ng-if="display.editReason">\
              <span> <b>Reason for Change</b>: {{ display.editReason.reason ===  \'Other\' ?  display.editReason.reasonText : display.editReason.reason }}</span>\
            </div>\
          </div>' ;
        break;
      case 'reference-sort':
        // depends on directive modelFieldReferenceSortEdit
        template = '<label class="col-sm-2 control-label">{{ display.label || key | translate }}:</label> \
          <div class="col-sm-10"> \
            <div class="error-message" ng-if="display.error.length > 0">{{ display.error }}</div>\
            <model-field-reference-sort-edit key="key" property="property" options="display.options" model-data="data" ng-model="data[key]" class="field" ng-required="{{ model.properties[key].required }}" ng-disabled="display.readonly"  /> \
            <div class="model-field-description" ng-if="display.description">{{ display.description | translate }}</div>\
          </div> \
          <label class="col-sm-2 control-label"></label> \
          <div class="col-sm-10"> \
            <div class="model-field-description" ng-if="display.description">{{ display.description | translate }}</div>\
          </div>';
        break;
      case 'list':
        // depends on directive modelFieldListEdit
        template = '<label class="col-sm-2 control-label">{{ display.label || key | translate }}:</label> \
          <div class="col-sm-10"> \
            <div class="error-message" ng-if="display.error.length > 0">{{ display.error }}</div>\
            <model-field-list-edit key="key" property="property" options="display.options" model-data="data" ng-model="data[key]" class="field" ng-required="{{ model.properties[key].required }}" ng-disabled="display.readonly"  /> \
            <div class="model-field-description" ng-if="display.description">{{ display.description | translate }}</div>\
          </div> \
          <label class="col-sm-2 control-label"></label> \
          <div class="col-sm-10"> \
            <div class="model-field-description" ng-if="display.description">{{ display.description | translate }}</div>\
          </div>';
        break;
      case 'file':
        // depends on directive modelFieldFileEdit
        template = '<label class="col-sm-2 control-label">{{ display.label || key | translate }}:</label> \
          <div class="col-sm-10"> \
            <div class="error-message" ng-if="display.error.length > 0">{{ display.error }}</div>\
            <model-field-file-edit key="key" options="display.options" ng-disabled="display.readonly" model-data="data" ng-model="data[key]" class="field" ng-change="ngEditReason({key: key})"/> \
            <div class="model-field-description" ng-if="display.description">{{ display.description | translate }}</div>\
            <div class="model-field-edit-reason" ng-if="display.editReason">\
              <span> <b>Reason for Change</b>: {{ display.editReason.reason ===  \'Other\' ?  display.editReason.reasonText : display.editReason.reason }}</span>\
            </div>\
          </div>';
        break;
      case 'image':
        // depends on directive modelFieldImageEdit
        template = '<label class="col-sm-2 control-label">{{ display.label || key | translate }}:</label> \
          <div class="col-sm-10"> \
            <div class="error-message" ng-if="display.error.length > 0">{{ display.error }}</div>\
            <model-field-image-edit key="key" options="display.options" ng-disabled="display.readonly" model-data="data" ng-model="data[key]" class="field" ng-change="ngEditReason({key: key})"/> \
          </div>\
          <label class="col-sm-2 control-label"></label> \
          <div class="col-sm-10"> \
            <div class="model-field-description" ng-if="display.description">{{ display.description | translate }}</div>\
            <div class="model-field-edit-reason" ng-if="display.editReason">\
              <span> <b>Reason for Change</b>: {{ display.editReason.reason ===  \'Other\' ?  display.editReason.reasonText : display.editReason.reason }}</span>\
            </div>\
          </div>';
        break;
      case 'video':
        // depends on directive modelFieldImageEdit
        template = '<label class="col-sm-2 control-label">{{ display.label || key | translate }}:</label> \
          <div class="col-sm-10"> \
            <div class="error-message" ng-if="display.error.length > 0">{{ display.error }}</div>\
            <model-field-video-edit key="key" options="display.options" ng-disabled="display.readonly" model-data="data" ng-model="data[key]" class="field" ng-change="ngEditReason({key: key})"/> \
            <div class="model-field-description" ng-if="display.description">{{ display.description | translate }}</div>\
            <div class="model-field-edit-reason" ng-if="display.editReason">\
              <span> <b>Reason for Change</b>: {{ display.editReason.reason ===  \'Other\' ?  display.editReason.reasonText : display.editReason.reason }}</span>\
            </div>\
          </div>';
        break;
      case 'datetime':
        template = '<label class="col-sm-2 control-label">{{ display.label || key | translate }}:</label> \
          <div class="col-sm-10"> \
            <div class="error-message" ng-if="display.error.length > 0">{{ display.error }}</div>\
            <p class="date-picker input-group"> \
              <input type="text" class="form-control" \
              control="dateControl"\
              locale="{{ display.options.locale }}"\
              min-date="{{ display.minDate }}" \
              max-date="{{ display.maxDate }}" \
              ng-model="data[key]" \
              default-date="{{data[key]}}" \
              ng-format="display.options.format" \
              ng-time-zone="display.options.timeZone" \
              ng-view-mode="display.options.viewMode" \
              ng-required="{{ model.properties[key].required }}" ng-disabled="{{ display.readonly }}"\
              on-change="onChange" \
              key="key" \
              data-date-time-picker \
               /> \
              <span class="input-group-btn"> \
                <button type="button" class="btn btn-default" ng-click="dateControl.show()" ng-disabled="{{ display.readonly }}"><i class="fa fa-calendar"></i></button> \
              </span>\
            </p> \
            <div class="model-field-description" ng-if="display.description">{{ display.description | translate }}</div>\
            <div class="model-field-edit-reason" ng-if="display.editReason">\
              <span> <b>Reason for Change</b>: {{ display.editReason.reason ===  \'Other\' ?  display.editReason.reasonText : display.editReason.reason }}</span>\
            </div>\
          </div>';
        break;
      case 'statuses':
        template = '<label class="col-sm-2 control-label" ng-if="data.isQualifyingProject" >{{ display.label || key | translate }}:</label>\
          <div class="col-sm-10 multi-select" ng-if="data.isQualifyingProject">\
            <div class="error-message" ng-if="display.error.length > 0">{{ display.error }}</div>\
            <model-field-api-multi-select key="key" property="property" options="display.options" ng-disabled="display.readonly" model-data="data" ng-model="data[key]" class="field" ng-blur="ngEditReason({key: key})"/>\
            <div class="model-field-description" ng-if="display.description">{{ display.description | translate }}</div>\
            <div class="model-field-edit-reason" ng-if="display.editReason">\
              <span> <b>Reason for Change</b>: {{ display.editReason.reason ===  \'Other\' ?  display.editReason.reasonText : display.editReason.reason }}</span>\
            </div>\
          </div>';
        break;
      case 'multi-select':
        template = '<label class="col-sm-2 control-label">{{ display.label || key | translate }}:</label>\
          <div class="col-sm-10 multi-select">\
            <div class="error-message" ng-if="display.error.length > 0">{{ display.error }}</div>\
            <model-field-multi-select key="key" property="property" options="display.options" ng-disabled="display.readonly" model-data="data" ng-model="data[key]" class="field" ng-blur="ngEditReason({key: key})"/>\
            <div class="model-field-description" ng-if="display.description">{{ display.description | translate }}</div>\
            <div class="model-field-edit-reason" ng-if="display.editReason">\
              <span> <b>Reason for Change</b>: {{ display.editReason.reason ===  \'Other\' ?  display.editReason.reasonText : display.editReason.reason }}</span>\
            </div>\
          </div>';
        break;
      case 'select':
        var ngOptions = 'key as (value | translate) for (key, value) in display.options';
        if (scope.property.display.options instanceof Array) {
          //Handle when options is array of objects containing key/value pair
          if (typeof scope.property.display.options[0] === 'object' && !Array.isArray(scope.property.display.options[0])) {
            ngOptions = 'item.key as item.value disable when item.disabled for item in display.options'
          } else {
            //Handle when options is a an array vs key/value pair object
            ngOptions = 'value as value for value in display.options';
          }
        }
        //NOTE: need to add empty <option> element to prevent weird AngularJS select issue when handling first selection
        template = '<label class="col-sm-2 control-label">{{ display.label || key | translate }}:</label>\
          <div class="col-sm-10">\
            <div class="error-message" ng-if="display.error.length > 0">{{ display.error }}</div>\
            <select ng-model="data[key]" ng-options="'+ngOptions+'" ng-required="{{ model.properties[key].required }}" class="field form-control" ng-disabled="{{ display.readonly }}" ng-change="onChange({key: key})"><option value=""></option></select>\
            <div class="model-field-description" ng-if="display.description">{{ display.description | translate }}</div>\
            <div class="model-field-edit-reason" ng-if="display.editReason">\
              <span> <b>Reason for Change</b>: {{ display.editReason.reason ===  \'Other\' ?  display.editReason.reasonText : display.editReason.reason }}</span>\
            </div>\
          </div>';
        break;
      case 'radio':
        var ngRepeat = '(value, text) in display.options';
        if (scope.property.display.options instanceof Array) {
          //Handle when options is array of objects containing key/value pair
          if (typeof scope.property.display.options[0] === 'object' && !Array.isArray(scope.property.display.options[0])) {
            ngRepeat = 'item in display.options'
          } else {
            //Handle when options is a an array vs key/value pair
            ngRepeat = 'text in display.options';
          }
        }
        template = '<label class="col-sm-2 control-label">{{ display.label || key | translate }}:</label>\
          <div class="col-sm-10 multi-select">\
            <div class="error-message" ng-if="display.error.length > 0">{{ display.error }}</div>\
            <div class="select-item checkbox-container" ng-repeat="'+ngRepeat+'" >\
              <input type="radio" ng-attr-id="{{key+\'-\'+$index}}" ng-model="data[key]" ng-value="value || text || item.key" ng-disabled="{{ display.readonly }}" name="{{key}}" ng-change="onChange({key: key})">\
              <label ng-attr-for="{{key+\'-\'+$index}}" class="radio">{{text || item.value}}</label>\
            </div>\
            <div class="model-field-description" ng-if="display.description">{{ display.description | translate }}</div>\
            <div class="model-field-edit-reason" ng-if="display.editReason">\
              <span> <b>Reason for Change</b>: {{ display.editReason.reason ===  \'Other\' ?  display.editReason.reasonText : display.editReason.reason }}</span>\
            </div>\
          </div>';
        break;
      case 'slider':
        template = '<label class="col-sm-2 control-label">{{ display.label || key | translate }}:</label>\
          <div class="col-sm-10">\
            <div class="error-message" ng-if="display.error.length > 0">{{ display.error }}</div>\
            <input slider ng-model="data[key]" options="display.options" class="slider ng-isolate-scope ng-valid ng-hide ng-dirty"> \
            <div class="model-field-description" ng-if="display.description">{{ display.description | translate }}</div>\
            <div class="model-field-edit-reason" ng-if="display.editReason">\
              <span> <b>Reason for Change</b>: {{ display.editReason.reason ===  \'Other\' ?  display.editReason.reasonText : display.editReason.reason }}</span>\
            </div>\
          </div>';
        break;
      case 'boolean':
        template = '<div class="col-sm-2"></div> \
          <div class="col-sm-10 checkbox-container">\
            <div class="error-message" ng-if="display.error.length > 0">{{ display.error }}</div>\
            <input type="checkbox" ng-attr-id="{{key}}" ng-model="data[key]" ng-checked="check(data, key)" class="field" ng-disabled="{{ display.readonly }}" ng-change="onChange({key: key})">\
            <label class="checkbox-label" ng-attr-for="{{key}}">{{ display.label || key | translate }}</label>\
            <div class="model-field-description" ng-if="display.description">{{ display.description | translate }}</div>\
            <div class="model-field-edit-reason" ng-if="display.editReason">\
              <span> <b>Reason for Change</b>: {{ display.editReason.reason ===  \'Other\' ?  display.editReason.reasonText : display.editReason.reason }}</span>\
            </div>\
          </div>';
        break;
      case 'password':
        template = '<label class="col-sm-2 control-label">{{ display.label || key | translate }}:</label>\
          <div class="col-sm-10">\
            <div class="error-message" ng-if="display.error.length > 0">{{ display.error }}</div>\
            <input type="password" ng-model="data[key]" ng-pattern="display.pattern" ng-disabled="{{ display.readonly }}" ng-required="{{ model.properties[key].required }}" class="field form-control">\
            <div class="model-field-description" ng-if="display.description">{{ display.description | translate }}</div>\
          </div>';
        break;
      case 'textarea':
        template = '<label class="col-sm-2 control-label">{{ display.label || key | translate }}:</label>\
          <div class="col-sm-10">\
            <div class="error-message" ng-if="display.error.length > 0">{{ display.error }}</div>\
            <textarea msd-elastic ng-model="data[key]" ng-keyup="lengthCheck($event)" ng-disabled="{{ display.readonly }}" ng-required="{{ model.properties[key].required }}" class="field form-control" ng-maxlength="{{ display.maxLength }}" ng-blur="getEditReason({key: key})"></textarea>\
            <div class="model-field-description">\
              <span ng-if="display.description"> {{ display.description | translate }} </span> \
              <span ng-if="display.maxLength"> &nbsp({{ charsLeft }} characters left) </span>\
            </div>\
            <div class="model-field-edit-reason" ng-if="display.editReason">\
              <span> <b>Reason for Change</b>: {{ display.editReason.reason ===  \'Other\' ?  display.editReason.reasonText : display.editReason.reason }}</span>\
            </div>\
          </div>';
        break;
      case 'wysiwyg':
      case 'WYSIWYG':
        template = '<label class="col-sm-2 control-label">{{ display.label || key | translate }}:</label>\
          <div class="col-sm-10">\
            <div class="error-message" ng-if="display.error.length > 0">{{ display.error }}</div>\
            <model-field-wysiwyg-edit key="key" property="property" options="display.options" model-data="data" ng-model="data[key]" class="field" ng-required="{{ model.properties[key].required }}" ng-disabled="display.readonly"  /> \
            <div class="model-field-description" ng-if="display.description">{{ display.description | translate }}</div>\
          </div>';
        break;
      case 'draw':
      case 'signature':
        template = '<label class="col-sm-2 control-label">{{ display.label || key | translate }}:</label>\
          <div class="col-sm-10">\
            <div class="error-message" ng-if="display.error.length > 0">{{ display.error }}</div>\
            <model-field-canvas-edit key="key" property="property" options="display.options" ng-model="data[key]" class="field" ng-required="{{ model.properties[key].required }}" ng-disabled="display.readonly" ng-change="ngEditReason({key: key})"></model-field-canvas-edit>\
            <div class="model-field-description" ng-if="display.description">{{ display.description | translate }}</div>\
            <div class="model-field-edit-reason" ng-if="display.editReason">\
              <span> <b>Reason for Change</b>: {{ display.editReason.reason ===  \'Other\' ?  display.editReason.reasonText : display.editReason.reason }}</span>\
            </div>\
          </div>';
        break;
      case 'location':
        template = '<label class="col-sm-2 control-label">{{ display.label || key | translate }}:</label>\
          <div class="col-sm-10">\
            <div class="error-message" ng-if="display.error.length > 0">{{ display.error }}</div>\
            <model-field-location-edit key="key" property="property" options="display.options" ng-model="data[key]" class="field" ng-required="{{ model.properties[key].required }}" ng-disabled="display.readonly"></model-field-location-edit>\
            <div class="model-field-description" ng-if="display.description">{{ display.description | translate }}</div>\
          </div>';
        break;
      case 'poi':
      case 'POI':
        template = '<label class="col-sm-2 control-label">{{ display.label || key | translate }}:</label>\
          <div class="col-sm-10">\
            <div class="error-message" ng-if="display.error.length > 0">{{ display.error }}</div>\
            <model-field-points-of-interest-edit key="key" property="property" options="display.options" ng-model="data[key]" class="field" ng-required="{{ model.properties[key].required }}" ng-disabled="display.readonly"></model-field-points-of-interest-edit>\
            <div class="model-field-description" ng-if="display.description">{{ display.description | translate }}</div>\
          </div>';
        break;
      case 'number':
        template = '<label class="col-sm-2 control-label">{{ display.label || key | translate }}:</label>\
          <div class="col-sm-10">\
            <div class="error-message" ng-if="display.error.length > 0">{{ display.error }}</div>\
            <model-field-number key="key" property="property" options="display.options" ng-required="model.properties[key].required" ng-disabled="display.readonly" model-data="data" ng-model="data[key]" ng-error="onFieldError(error)" class="field" ng-edit-reason="ngEditReason({key: key})"/>\
            <div class="model-field-description" ng-if="display.description">{{ display.description | translate }}</div>\
            <div class="model-field-edit-reason" ng-if="display.editReason">\
              <span> <b>Reason for Change</b>: {{ display.editReason.reason ===  \'Other\' ?  display.editReason.reasonText : display.editReason.reason }}</span>\
            </div>\
          </div>';
        break;
      case 'phoneNumber':
        template = '<label class="col-sm-2 control-label">{{ display.label || key | translate }}:</label>\
          <div class="col-sm-10">\
            <div class="error-message" ng-if="display.error.length > 0">{{ display.error }}</div>\
            <input type="hidden" ng-model="countrycode" value="{{ display.region }}" />\
            <input type="text" ng-model="data[key]" phone-number country-code="countrycode" ng-pattern="display.pattern" ng-disabled="{{ display.readonly }}" ng-required="{{ model.properties[key].required }}" class="field form-control">\
            <div class="model-field-description" ng-if="display.description">{{ display.description | translate }}</div>\
          </div>';
        break;
      case 'text':
      default:
        template = '<label class="col-sm-2 control-label">{{ display.label || key | translate }}:</label>\
          <div class="col-sm-10">\
            <div class="error-message" ng-if="display.error.length > 0">{{ display.error }}</div>\
            <div ng-class="{\'input-status-indicator\': display.showStatusIndicator}">\
              <input type="text" ng-model="data[key]" ng-keyup="lengthCheck($event)" ng-pattern="display.pattern" ng-disabled="{{ display.readonly }}" ng-required="{{ model.properties[key].required }}" class="field form-control" ng-maxlength="{{ display.maxLength }}" ng-blur="getEditReason({key: key})">\
              <div class="field-status-indicator" ng-if="display.showStatusIndicator">\
                <i class="fa" ng-class="{\'fa-check\': display.isValid && !display.isLoading, \'fa-warning\': !display.isValid && !display.isLoading, \'fa-spinner rotating\': display.isLoading}"></i>\
              </div>\
            </div>\
            <div class="model-field-description" ng-if="display.description || display.maxLength">\
              <span ng-if="display.description"> {{ display.description | translate }} </span> \
              <span ng-if="display.maxLength"> &nbsp({{ charsLeft }} characters left) </span>\
            </div>\
            <div class="model-field-edit-reason" ng-if="display.editReason">\
              <span> <b>Reason for Change</b>: {{ display.editReason.reason ===  \'Other\' ?  display.editReason.reasonText : display.editReason.reason }}</span>\
            </div>\
          </div>';
    }
    return template;
  }

  function addInputAttributes(element, inputAttr) {
    var $input = $(element).find('input');
    if (inputAttr && $input) {
      for(var attr in inputAttr) {
        $input.attr(attr, inputAttr[attr]);
      }
    }
  }

  return {
    restrict: 'E',
    scope: {
      key: '=key',
      model: '=model',
      data: '=ngModel',
      ngError: '&',
      ngEditReason: '&'
    },
    link: function(scope, element, attrs) {

      var property;

      function init() {

        scope.onFieldError = onFieldError;

        //In situations where edit form has fields not in the model json properties object (i.e. ModelFieldReference multi-select)
        if(scope.key !== null && typeof scope.key === 'object') {
          if (!scope.model.properties[scope.key.property]) {
            scope.model.properties[scope.key.property] = {};
          }
          //override default display logic
          scope.model.properties[scope.key.property].display = scope.key;
          scope.key = scope.key.property;
        }

        property = { display: {type: "text"} };
        if (scope.model.properties && scope.model.properties[scope.key]) property = scope.model.properties[scope.key];
        if (!property) {
          console.log("ModelField link error: no property for model '" + scope.model.name + "'; property key = '" + scope.key + "' found!");
          return; //ABORT if no property definition
        }
        if (!property.display || !property.display.type) {
          if (!property.display) property.display = {};
          //TODO: check the property definition in the loopback model and pick a better default "type"
          switch (property.type) {
            case "date":
            case "Date":
              property.display.type = "datetime";
              break;
            default: property.display.type = "text"; break;
          }
        }

        //Initialize the various Field Type custom logic
        initFieldType(property);

        //See if there is a default value
        if (!scope.data[scope.key] && (property["default"] || typeof property["default"] === 'number')) {
          scope.data[scope.key] = property["default"];
        }

        //scope variables needed for the HTML Template
        scope.property = property;
        scope.display = property.display;

        if (property.display.editTemplate) {
          element.html(property.display.editTemplate).show();
        } else {
          element.html(getTemplate(property.display.type, scope)).show();
        }
        // add input attributes if specified in schema
        addInputAttributes(element, scope.property.display.inputAttr);

        if (scope.display.pattern && scope.display.pattern[0] == '/' && scope.display.pattern[scope.display.pattern.length-1] == '/') {
          //As of Angular 1.6 upgrade ng-pattern does not accept leading and trailing / in string regex; angular uses new RegExp() which does not accept / characters
          scope.display.pattern = scope.display.pattern.slice(1, scope.display.pattern.length-2);
        }

        initFieldError();

        $compile(element.contents())(scope);
      }

      function initFieldError() {
        if (scope.key && !scope.data[scope.key]) {
          scope.display.error = ''
          if (scope.ngError) scope.ngError({error: null});
        }
      }

      function onFieldError(error) {
        if (error && error.message) {
          property.display.error = error.message;
        } else {
          delete property.display.error;
        }
        if (scope.ngError) scope.ngError({error: error});
      }

      function initFieldType() {

        // TODO: generalize isRequired validation option

        if (property.display.type === 'text' || property.display.type === 'textarea') {
          var hasDataChanged = false;
          var length = scope.data[scope.key] ? scope.data[scope.key].length : 0;
          scope.charsLeft = property.display.maxLength - length; /*calculate outside of function so we have a starting value */

          // validate text length
          scope.lengthCheck = function(e) {
            hasDataChanged = true;
            scope.charsLeft = property.display.maxLength - e.target.value.length;
            if (property.display.maxLength && e.target.value.length > property.display.maxLength) {
              scope.display.error = "Text is longer than the maximum allowed length of " + scope.display.maxLength + " characters.";
              if (scope.ngError) scope.ngError({error: new Error(scope.display.error)});
              return;
            } else if (property.display.maxLength && e.target.value.length <= property.display.maxLength && e.target.value.length > 0) {
              delete scope.display.error;
              delete scope.display.errorCode;
              if (scope.ngError) scope.ngError({error: null});
              return
            } else if (e.target.value.length === 0 && property.display.isRequired) {
              scope.display.error = "This is a required field.";
              if (scope.ngError) scope.ngError({error: new Error(scope.display.error)});
            }
          };

          scope.getEditReason = function(key) {
            if (scope.ngEditReason && hasDataChanged) {
              scope.ngEditReason(key)
            }
            hasDataChanged = false
          }
        }

        if (property.display.type === 'radio' || property.display.type === 'select' || property.display.type === 'datetime' || property.display.type === 'boolean') {
          scope.onChange = function(key) {
            var hasDataChanged = true
            if (scope.ngEditReason && hasDataChanged) {
              scope.ngEditReason(key)
            }
            hasDataChanged = false
          }
        }

        if (property.display.type == 'file' && scope.data[scope.key]) {
          //Check if image file is uploaded and convert schema property display type to image
          var filename = scope.data[scope.key];
          if (typeof filename === 'object' && filename.filename) filename = filename.filename;
          else if (typeof filename === 'object' && filename.file) filename = filename.file.name;
          if (filename && typeof filename === 'text') {
            var extension = filename.toLowerCase().substring(filename.length-4);
            if (extension == '.png' || extension == '.jpg' || extension == 'jpeg' || extension == '.bmp') {
              property = angular.copy(property); //we don't want changes the schema property to persist outside of this directive
              property.display.type = 'image';
            }
          }
        }

        //Set default date format
        if (property.display.type == "datetime") {
          if (!property.display.options) property.display.options = {};
          if (!property.display.options.format) property.display.options.format = "YYYY-MM-DD  h:mm A";
        }

        if (!scope.data[scope.key] && property.display.defaultValueUsingModelKey) {
          scope.data[scope.key] = scope.data[property.display.defaultValueUsingModelKey];
        }

        if (scope.data[scope.key] && property.display.convertToLocalTime === false) {
          //remove the 'Z' from the end of the timestamp so that it is not converted to local time
          scope.data[scope.key] = scope.data[scope.key].substring(0, scope.data[scope.key].length-1);
        }

        if (property.display.type == "boolean") {
          scope.check = function(data, key) {
            //This function is needed to accept string '1' and numeric 1 values when state changes
            var value = data[key];
            if (value == undefined || value == null) return property.display.default;
            data[key] = value == '1' || value == 1; //Fixes a bug where data[key] changes from bool to string can cause checkbox to get unchecked
            if (property.display.isRequired && !scope.data[scope.key]) {
              scope.display.error = "This is a required field."
              if (scope.ngError) scope.ngError({error: new Error(scope.display.error)});
            } else {
              delete scope.display.error;
              if (scope.ngError) scope.ngError({error: null});
            }
            return data[key];
          }
          //Make sure boolean (checkbox) values are numeric (below only gets called on init and not when state changes)
          if (typeof scope.data[scope.key] === "string") scope.data[scope.key] = parseInt(scope.data[scope.key]);
        }

        if (property.display.type == "slider") {
          if (typeof scope.data[scope.key] === 'undefined' || scope.data[scope.key] == null) {
            scope.data[scope.key] = property.display.options.from + ";" + property.display.options.to;
          }
        }
      }

      init();

    }
  };
}])

;

angular.module('dashboard.directives.ModelFieldApiMultiSelect', [])

.directive('modelFieldApiMultiSelect', ['$compile', '$timeout', 'GeneralModelService', function($compile, $timeout, GeneralModelService) {
  "ngInject";

  function getTemplate() {
    var template =
      '<div class="select-all">'+
        '<input type="checkbox" class="field" ng-attr-id="select-all" ng-model="selectAll" ng-disabled="disabled" ng-change="selectAllChange(selectAll)">' +
        '<label class="checkbox-label status" ng-attr-for="select-all"><span class="select-all">Select All</span></label>' +
      '</div><br>' +
      '<div class="select-item checkbox-container" ng-repeat="item in multiSelectOptions">' +
        '<input type="checkbox" class="field" ng-attr-id="{{key+\'-\'+$index}}" ng-model="selected[$index]" ng-checked="selected[$index]" ng-disabled="disabled" ng-change="clickMultiSelectCheckbox($index, item)">' +
        '<label class="checkbox-label status" ng-attr-for="{{key+\'-\'+$index}}"><span class="{{item.key}}">{{ item.value }}</span></label>' +
      '</div>';
    return template;
  }

  return {
    restrict: 'E',
    require: "ngModel",
    scope: {
      key: '=key',
      property: '=property',
      options: '=options',
      data: '=ngModel',
      modelData: '=modelData',
      disabled: '=ngDisabled',
      ngBlur: '&',
    },
    link: function(scope, element, attrs, ngModel) {
      
      var property = scope.property;
      var hasDataChanged;
      
      String.prototype.replaceAt=function(index, replacement) {
          return this.substr(0, index) + replacement+ this.substr(index + replacement.length);
      }

      function init() {
        scope.multiSelectOptions = [];
        scope.selected = [];
        if (!property) property = {};
        if (!property.display) property.display = {};

        initOptions();
        initData();

        //Handle translating multi-select checks to scope.data output format
        scope.clickMultiSelectCheckbox = clickMultiSelectCheckbox;
        scope.selectAllChange = selectAllChange;

        console.log('scope ->', scope);
        
        let apiPath = scope.options && scope.options.api ? scope.options.api : '';
        let params = {};
        GeneralModelService.list(apiPath, params, {preventCancel: true}).then(function(response){
          if (!response) return;

          for(var i=0; i<response.length; i++) {
            response[i].value = makeReadable(response[i].value);
            if (response[i].value.indexOf('Mrf') > -1) {
              response[i].value = response[i].value.replace('Mrf', 'MRF');
            }
          }

          scope.multiSelectOptions = response;
          element.html(getTemplate()).show();
          $compile(element.contents())(scope);

          if (scope.modelData && scope.modelData.trialId) {
            let apiPath = scope.modelData.isQualifyingProject ? scope.options.qualifyingStatusApi : scope.options.trialApi;
            let output = {};
            let index;
            apiPath += scope.modelData.trialId;
            GeneralModelService.list(apiPath, {}, {preventCancel: true}).then(function(response) {
              for (var i=0; i<response.length; i++) {
                index = _.findIndex(scope.multiSelectOptions, {key: response[i].status});
                scope.selected[index] = true;
                output[scope.multiSelectOptions[index].key] = scope.multiSelectOptions[index].value;
              }
              scope.data = output;
            })
          }

          scope.$on('removeModelFieldMultiSelect', function($event, key) {
            if (key !== scope.key) return;
            $timeout(function() {
              initData();
            }, 1)
          })
        })
      }

      function makeReadable(string) {
        for (var i=0; i<string.length; i++) {
          if (i === 0) {
              string = string.replaceAt(i, string[i].toUpperCase());
          }
          if (i > 0 && string[i-1] === '_') {
              string = string.replaceAt(i, string[i].toUpperCase());
              string = string.replaceAt(i-1, ' ');
          }
        }
        return string;
      }

      /**
       * parses multi-select options and checks if string, array, or object
       * if string - try parsing first based on new line character; if no new-line character assume comma separated
       * if array - check if array of string values or array of key/value pair objects
       * if object - parse as key/value pair object ordered by key
       */
      function initOptions() {
        var options = scope.options || property.display.options;
        if (typeof options === 'string') {
          //Check if options on new line
          if (options.indexOf('\n') > -1) {
            //Options separated by new line
            options = options.split('\n');
          } else {
            //assume options separated by comma
            options = options.split(',');
          }
        }

        var keyOverride = property.display.key || 'key';
        var valueOverride = property.display.value || 'value';
        if (Array.isArray(options)) {
          //Check if array of strings
          for (var i in options) {
            var item = options[i];
            if (typeof item === 'string') {
              //string option
              var option = {key: item, value: item};
              scope.multiSelectOptions.push(option);
            } else if (item && typeof item === 'object') {
              //Objects (key/value pair)
              var key = item[keyOverride] || i; //fallback to index if no key
              var option = { key: key, value: item[valueOverride], item: item };
              scope.multiSelectOptions.push(option);
            }
          }

        } else if (options && typeof options === 'object') {
          //Assume object containing key/value pair
          var keys = Object.keys(options);
          for (var k in keys) {
            var key = keys[k];
            var option = { key: key, value: options[key] };
            scope.multiSelectOptions.push(option);
          }
        }
      }

      /**
       * Initial data load by checking desired output as comma, array, or object
       */
      function initData() {
        // reset all to false - used to rebuild data if revert is required
        for (var k in scope.selected) {
          scope.selected[k] = false
        };
        if (typeof property.display.output === 'undefined') {
          var options = scope.options || property.display.options;
          property.display.output = options instanceof Array ? "comma" : "object";
        }
        if (typeof scope.data === 'string') {
          if (!scope.data) scope.data = "";
          var items = scope.data.split('","');
          for (var i in items) {
            var item = items[i];
            if (item[0] == '"') item = item.substring(1, item.length);
            if (item[item.length-1] == '"') item = item.substring(0, item.length-1);
            var index = _.findIndex(scope.multiSelectOptions, {key: item});
            if (index > -1) scope.selected[index] = true;
          }
        } else if (Array.isArray(scope.data)) {
          if (!scope.data) scope.data = [];
          for (var i in scope.data) {
            var value = scope.data[i];
            var index = _.findIndex(scope.multiSelectOptions, {key: value});
            if (index > -1) scope.selected[index] = true;
          }
        } else if (scope.data && typeof scope.data === 'object') {
          if (!scope.data) scope.data = {};
          var keys = Object.keys(scope.data);
          for (var k in keys) {
            var key = keys[k];
            var index = _.findIndex(scope.multiSelectOptions, {key: key});
            if (index > -1) scope.selected[index] = true;
          }
        }
      }

      function clickMultiSelectCheckbox(index, selectedOption) {
        hasDataChanged = true;
        var output = property.display.output === 'array' ? [] : property.display.output === 'object' ? {} : '';

        if (scope.selected.indexOf(false) > -1) {
          scope.selectAll = false;
        }

        for (var i in scope.selected) {
          if (scope.selected[i]) {
            var option = scope.multiSelectOptions[i];
            switch (property.display.output) {
              case 'object':
                output[option.key] = option.value;
                break;
              case 'comma':
                output += '"' + option.key + '",'; //quote qualified
                break;
              case 'array':
                output.push(selectedOption.item || selectedOption.key); // return array
                break;
            }

          }
        }

        if (property.display.output === 'comma' && output.length > 0) output = output.substring(0, output.length-1); //remove last comma

        scope.data = output;

        // asynchronous behavior because moving data up chain
        setTimeout(function() {
          if (scope.ngBlur && hasDataChanged) {
            scope.ngBlur({key: scope.key})
          }
          hasDataChanged = false
        // this may cause a non optimal user experience, but reducing ability to bypass the check
        }, 1);
      
        if (scope.selected.indexOf(true) < 0) {
          console.log('we get here...');
          delete scope.data;
        }

        // Note: breaking changes on onModelFieldMultiSelectCheckboxClick emit below after Angular 1.6.4 upgrade
        // due to ModelFieldMultiSelect rewrite
        //scope.$emit('onModelFieldMultiSelectCheckboxClick', scope.key, selectedOption, selected);
      }

      function selectAllChange(selectAll) {
        console.log('we got here :)');
        var output = {};
        if (selectAll) {
          for (var i=0; i<scope.multiSelectOptions.length; i++) {
            output[scope.multiSelectOptions[i].key] = scope.multiSelectOptions[i].value;
            scope.selected[i] = true;
          }
          scope.data = output;
        } else {
          for (var i=0; i<scope.multiSelectOptions.length; i++) {
            scope.selected[i] = false;
            delete scope.data;
          }
        }
      }

      init();
    }
  };
}])

;

angular.module('dashboard.directives.ModelFieldCanvas', [
    'dashboard.Dashboard.Model.Edit.SaveDialog',
    "dashboard.Config",
    "ui.bootstrap",
    "dashboard.services.GeneralModel",
    "ui.select"
  ])

.directive('modelFieldCanvasView', ['$compile', function($compile) {
  "ngInject";

  return {
    restrict: 'E',
    template: '<b>{{ options.model }}</b>: {{ data[options.key] }}',
    scope: {
      options: '=options',
      data: '=ngModel',
      required: 'ngRequired',
      disabled: 'disabled'
    },
    link: function(scope, element, attrs) {
    }
  };
}])

.directive('modelFieldCanvasEdit', ['$compile', '$cookies', '$timeout', 'Config', 'FileUploadService', function($compile, $cookies, $timeout, Config, FileUploadService) {
  "ngInject";

  function getTemplate() {
    var template = '\
    <img ng-src="{{ data.fileUrl || data }}" crossOrigin="anonymous" class="disabled-div" ng-hide="!disabled"/></img>\
    <canvas ng-hide="disabled" ng-signature-pad="signature" width="300" height="150" ng-mouseup="changed()"></canvas>\
    <button ng-hide="disabled" class="btn btn-default" ng-click="clearCanvas()">Clear</button>\
  ';
    return template;
  }

  return {
    restrict: 'E',
    require: "ngModel",
    scope: {
      key: '=key',
      property: '=property',
      options: '=options',
      data: '=ngModel',
      modelData: '=modelData',
      disabled: '=ngDisabled',
      ngChange: '&',
    },
    link: function(scope, element, attrs, ngModel) {

      scope.isLoading = true;
      scope.signature = {};

      scope.$on('revertDataSignature', function($event, key) {
        if (key !== scope.key) return;
        $timeout(function() {
          scope.isLoading = true;
          var canvas = scope.signature._canvas;
          var context = scope.signature._canvas.getContext("2d");
          context.clearRect(0, 0, canvas.width, canvas.height);
          drawNewImage()
        }, 1)
      })

      scope.clearCanvas = function() {
        var canvas = scope.signature._canvas;
        var context = scope.signature._canvas.getContext("2d");
        context.clearRect(0, 0, canvas.width, canvas.height)
        scope.data = null;
        if (scope.ngChange) {
          setTimeout(function() {
            scope.ngChange({key: scope.key})
          }, 1)
        }
      };

      scope.$watch('signature._mouseButtonDown', function() {
        drawNewImage()
      });

      function drawNewImage() {
        if (scope.signature.fromDataURL && scope.isLoading) {
          //Load Existing Signature
          scope.isLoading = false;
          //Load Image because of CORS issue
          var image = new Image();
          image.setAttribute('crossOrigin', 'anonymous');
          image.onload = function() {
            var context = scope.signature._canvas.getContext("2d");
            context.drawImage(image, 0, 0);
          };
          if (scope.data && typeof scope.data === 'object' && scope.data.fileUrl) {
            image.src = scope.data.fileUrl;
          } else {
            image.src = scope.data;
          }
        } else if (scope.signature.toDataURL) {
          //When done signing store into data
          var dataUrl = scope.signature.toDataURL();
          scope.data = dataUrl;
        }
      }

      scope.changed = function() {
        if (scope.ngChange) {
          setTimeout(function() {
            scope.ngChange({key: scope.key})
          }, 1)
        }
      }

      element.html(getTemplate()).show();
      $compile(element.contents())(scope);
    }
  };
}])

;

angular.module('dashboard.directives.ModelFieldFile', [
  "dashboard.services.GeneralModel"
])

.directive('modelFieldFileView', ['$compile', function($compile) {
  "ngInject";

  return {
    restrict: 'E',
    template: '<b>{{ field.label }}</b>: {{ data[field.name] }}',
    scope: {
      field: '=options',
      data: '=ngModel'
    },
    link: function(scope, element, attrs) {

    }
  };
}])

.directive('modelFieldFileEdit', ['$compile', '$document', '$window', 'GeneralModelService', 'SessionService', '$translate', function($compile, $document, $window, GeneralModelService, SessionService, $translate) {
  "ngInject";

  return {
    restrict: 'E',
    template: '<button class="btn btn-default select-file" ng-hide="disabled" >{{ selectFileButtonText }}</button> \
      <input type="file" ng-file-select="onFileSelect($files)" ng-hide="disabled"> \
      <button ng-if="filename" class="btn btn-danger fa fa-trash" ng-click="clear($event)" ng-hide="disabled"></button> \
      <span class="file-upload-info" ng-if="filename"><i class="fa {{getFileIcon(filename)}}"></i>&nbsp;&nbsp;{{ filename }}&nbsp;&nbsp;<span ng-if="fileUrl">(<a download href="{{fileUrl}}">download</a><span ng-if="previewUrl"> | <a target="_blank" href="{{previewUrl}}">preview</a></span>)</span></span> \
      <div ng-file-drop="onFileSelect($files)" ng-file-drag-over-class="optional-css-class-name-or-function" ng-show="dropSupported" class="file-drop">Drop File Here</div>',
    scope: {
      key: "=key",
      options: '=options',
      disabled: '=ngDisabled',
      data: '=ngModel',
      modelData: '=modelData',
      ngChange: '&',
    },
    link: function(scope, element, attrs) {

      scope.selectFileButtonText = 'Select File';
      scope.clearButtonText = 'Clear';
      var translationBtnKeys = ['button.select_file'];
      $translate(translationBtnKeys)
        .then(function (translated) {
          // If one of the key is missing, result will be the specified key inside translationBtnKeys
          if (translationBtnKeys.indexOf(translated['button.select_file']) === -1) {
            scope.selectFileButtonText = translated['button.select_file'];
          }
        });


      /**
         * scope.data updates async from controller so need to watch for the first change only
         */
        var unwatch = scope.$watchCollection('data', function(data) {
          if (data) {
            // unwatch(); // Initially for removing the watcher, but with edit reason reintroduced // Remove the watch
            if (scope.data && scope.data && scope.data.filename) {
              //expects scope.data to be an object with {filename, fileUrl}
              scope.filename = scope.data.filename;
              scope.fileUrl = scope.data.fileUrl;
              scope.previewUrl = scope.data.previewUrl;
            } else if (typeof scope.data === 'string') {
              scope.fileUrl = scope.data.replace(/%2F/g, "/");
              var pos = scope.fileUrl.indexOf("documents/");
              if (pos < 0) {
                pos = scope.fileUrl.indexOf("documents%2F") + 11
              } else {
                pos = pos + 9;
              }
              var signPos = scope.fileUrl.indexOf("?Expires");
              if (signPos < 0) signPos = scope.fileUrl.length;
              scope.filename = scope.fileUrl.substring(pos+1, signPos);
            } else if (typeof scope.data.file === 'object') {
              var s3Path = scope.options.path; //S3 path needed when getting S3 Credentials for validation;
              scope.data = {path: s3Path, file: scope.data.file};
              scope.filename = scope.data.file.name;
              scope.fileUrl = null;
              scope.previewUrl = null;
            }
          }
       });
      
        scope.getFileIcon = function(filename) {
          var extension = filename.substring(filename.lastIndexOf("."));
          switch(extension.toLowerCase()) {
          case ".txt":
            return "fa-file-text-o";
          case ".doc":
          case ".docx":
            return "fa-file-word-o";
          case ".wav":
          case ".mp3":
          case ".aif":
            return "fa-file-audio-o";
          case ".m4v":
          case ".mov":
          case ".mp4":
          case ".avi":
            return "fa-file-video-o";
          case ".jpg":
          case ".jpeg":
          case ".png":
          case ".gif":
          case ".bmp":
          case ".tif":
            return "fa-file-image-o";
          case ".xls":
          case ".xlsx":
             return "fa-file-excel-o";
          case ".ppt":
          case ".pptx":
             return "fa-file-excel-o";
          case ".pdf":
             return "fa-file-pdf-o";
          default:
            return "fa-file-o";
          }
        };

        scope.onFileSelect = function($files) {
          // clear the data on a new file select
          if (scope.data !== undefined) scope.clear({}, true);
          //$files: an array of files selected, each file has name, size, and type.
          if ($files.length < 1) return;
          var selectedFile = $files[0];
          var s3Path = scope.options.path; //S3 path needed when getting S3 Credentials for validation;
          scope.data = {path: s3Path, file: selectedFile};
          scope.filename = selectedFile.name;
          scope.fileUrl = null;

        };

        scope.clear = function(e, isSkipConfirm, isSkipEditReason) {
          if (e && e.preventDefault) e.preventDefault();
          if (scope.options.confirm && !isSkipConfirm) {
            // Requires confirmation alert
            if (!confirm('Are you sure you would like to remove the file?')) {
              return;
            }
          }
          scope.data = null;
          scope.filename = null;
          scope.fileUrl = null;
          if (scope.ngChange && !isSkipEditReason) {
            setTimeout(function() {
              scope.ngChange({key: scope.key})
            }, 1)
          }
        };

        //Prevent accidental file drop
        $document.on("drop", function(event) {
          if (event.target.nodeName != "INPUT") {
            event.preventDefault();
          } 
        });
        $document.on("dragover", function( event ) {
          event.preventDefault();
          //Show Drop Target
          element.find(".file-drop").addClass("show");
        });
        
        $(window).on("mouseleave", function() {
          //Hide Drop Target
          element.find(".file-drop").removeClass("show");
        });
        
        scope.$on('$destroy', function() {
          //event clean up
          $document.off("drop");
          $document.off("dragover");
          $(window).off("mouseleave");
        });

        scope.$on('removeModelFieldFile', function(event, key, isSkipConfirm, isSkipEditReason) {
          if (key !== scope.key) return;
          scope.clear(null, isSkipConfirm, isSkipEditReason)
        })

    }
  };
}])

;

angular.module('dashboard.directives.ModelFieldImage', [
  "dashboard.services.GeneralModel",
  "dashboard.services.Image"
])

.directive('modelFieldImageView', ['$compile', function($compile) {
  "ngInject";

  return {
    restrict: 'E',
    template: '<b>{{ field.label }}</b>: {{ data[field.name] }}',
    scope: {
      field: '=options',
      data: '=ngModel'
    },
    link: function(scope, element, attrs) {

    }
  };
}])

.directive('modelFieldImageEdit', ['$compile', '$document', 'GeneralModelService', 'ImageService', 'SessionService', '$timeout', '$translate', function($compile, $document, GeneralModelService, ImageService, SessionService, $timeout, $translate) {
  "ngInject";

  return {
    restrict: 'E',
    require: '^form',
    template: '<div ng-class="isDisplayOnly ? \'display-only\' : \'image-container\'" style="background: no-repeat center center url(\'{{ thumbnailUrl }}\'); background-size: contain;" ng-click="!isDisplayOnly && imageClick()"></div> \
      <div class="button-menu show-menu">\
      <button class="btn btn-default upload-button" ng-hide="disabled">{{ selectFileButtonText }}</button> \
      <button class="btn btn-default clear-button" ng-show="imageUrl && !disabled" ng-click="clear()">{{ clearButtonText }}</button> \
      </div> \
      <div ng-file-drop="onFileSelect($files)" ng-file-drag-over-class="optional-css-class-name-or-function" ng-show="dropSupported && !disabled" class="image-drop">{{ uploadStatus }}</div> \
      <div ng-file-drop-available="dropSupported=true" ng-show="!dropSupported">HTML5 Drop File is not supported!</div> \
      <input type="file" ng-file-select="onFileSelect($files)" ng-hide="disabled"> \
      <button ng-click="upload.abort()" class="cancel-button">Cancel Upload</button>',
    scope: {
      key: "=key",
      options: '=options',
      disabled: '=ngDisabled',
      data: '=ngModel',
      modelData: '=modelData',
      ngChange: '&',
    },
    link: function(scope, element, attrs, formController) {
        var selectedFile = null;
        var hasDataChanged = false;
        // Set translation label
        scope.selectFileButtonText = 'Select File';
        scope.clearButtonText = 'Clear';
        var translationBtnKeys = ['button.select_file', 'button.clear'];
        $translate(translationBtnKeys)
          .then(function (translated) {
            // If one of the key is missing, result will be the specified key inside translationBtnKeys
            if (translationBtnKeys.indexOf(translated['button.select_file']) === -1) {
              scope.selectFileButtonText = translated['button.select_file'];
            }
            if (translationBtnKeys.indexOf(translated['button.clear']) === -1) {
              scope.clearButtonText = translated['button.clear'];
            }
          });

        scope.uploadStatus = "Upload File";

        // For question type image-display
        if (scope.options.isDisplayOnly) {
          scope.isDisplayOnly = true;
          scope.thumbnailUrl = scope.options.imageUrl;
        }

        /**
         * scope.data updates async from controller so need to watch for the first change only
         */
        var unwatch = scope.$watch('data', function(data) {
          if (data) {
            // unwatch(); // Initially for removing the watcher, but with edit reason reintroduced // Remove the watch
            if (!scope.options || !scope.options.model) {
              //Not a Table reference (the field contains the image URL)
              if (typeof data === "string") {
                scope.imageUrl = data;
                scope.thumbnailUrl = scope.options.thumbnailUrl;

                if (scope.thumbnailUrl) {
                  // create a new image against possible thumbnail url
                  var image = new Image();
                  image.onerror = function() {
                    $timeout(function() {
                      scope.thumbnailUrl = scope.imageUrl;
                    });
                  };
                  // set the src which will trigger onload/onerror events
                  image.src = scope.thumbnailUrl;
                } else {
                  scope.thumbnailUrl = scope.imageUrl;
                }

              } else if (typeof data === "object") {
                if (data.fileUrl) scope.imageUrl = data.fileUrl;
                if (data.imageUrl) scope.imageUrl = data.imageUrl;
                if (!scope.imageUrl && data.file) {
                  //Handle file objects
                  selectedFile = data.file;
                  fileReader.readAsDataURL(data.file);
                }
              }
            } else {
              //Media table reference (data is the ID reference)
              GeneralModelService.get(scope.options.model, data)
              .then(function(response) {
                if (!response) return;  //in case http request was cancelled
                //scope.options.urlKey defines the column field name for where the URL of the image is stored
                scope.imageUrl = response[scope.options.urlKey];
                if (!scope.imageUrl) scope.imageUrl = response["mediumUrl"]; //HACK FOR SMS PROJECT (PROB SHOULD REMOVE)
                scope.thumbnailUrl = scope.imageUrl;
              });
            }
          }
        });

        //Use the FileReader to display a preview of the image before uploading
        var fileReader = new FileReader();
        fileReader.onload = function (event) {
          //bind back to parent scope's __ModelFieldImageData object with info on selected file
          var s3Path = scope.options.path; //S3 path needed when getting S3 Credentials for validation;
          var imageData = {path: s3Path, file: selectedFile};
          if (!scope.modelData.__ModelFieldImageData) scope.modelData.__ModelFieldImageData = {};
          if (scope.options && scope.options.urlKey) {
            //When field options involve a reference table use model key and urlKey as reference
            if (!scope.modelData.__ModelFieldImageData[scope.key]) scope.modelData.__ModelFieldImageData[scope.key] = {};
            scope.modelData.__ModelFieldImageData[scope.key][scope.options.urlKey] = imageData;
          } else {
            //No table reference (file URL assigned directly into current model's field)
            scope.modelData.__ModelFieldImageData[scope.key] = imageData;
          }
          formController.$setDirty()

          //Set the preview image via scope.imageUrl binding
          ImageService.fixOrientationWithDataURI(event.target.result, function(error, dataURI) {
            scope.imageUrl = dataURI;
            scope.thumbnailUrl = dataURI;
            imageData.file = scope.dataURItoBlob(dataURI);
            imageData.file.name = selectedFile.name;
            //Check for any export requirements and export image of various sizes specified in config
            if (scope.options && scope.options.export) {
              scope.uploadStatus = "Creating Image Sizes";
              scope.exportImages(function() {
                scope.uploadStatus = "Upload File";
                scope.$apply();
              });
            } else if (scope.options && scope.options.resize) {
              scope.resizeImage(dataURI, scope.options.resize, function(blob) {
                imageData.file = blob; //Set the resized image back to the ModelFieldImageData
              });
            }
            scope.$apply();
          });
        };
        fileReader.onerror = function(error) {
          console.log(error);
        };

        scope.clear = function(isSkipConfirm, isSkipEditReason) {
          if (scope.options.confirm && !isSkipConfirm) {
            // Requires confirmation alert
            if (!confirm('Are you sure you would like to remove this photo?')) {
              return;
            }
          }
          scope.data = null; //null out the data field
          if (scope.modelData.__ModelFieldImageData && scope.modelData.__ModelFieldImageData[scope.key]) {
            //make sure to remove any pending image uploads for this image field
            delete scope.modelData.__ModelFieldImageData[scope.key];
          }
          delete scope.imageUrl; //remove the image
          delete scope.thumbnailUrl; //remove the image
          formController.$setDirty();
          if (scope.ngChange && !isSkipEditReason) {
            setTimeout(function() {
              scope.ngChange({key: scope.key})
            }, 1)
          }
        };
        
        scope.onFileSelect = function($files) {
          // clear the data on a new file select
          if (scope.data !== undefined) scope.clear(true);
          //$files: an array of files selected, each file has name, size, and type.
          if ($files.length < 1) return;
          selectedFile = $files[0];
          var isAllowed = false;
          if (scope.options.extensions) {
            scope.options.extensions.forEach(function(extension) {
              if (selectedFile.type.match('image/'+extension)) {
                isAllowed = true;
              }
            });
          } else {
            isAllowed = true;
          }

          if (!isAllowed) {
            alert('File must be of the following file types (' + scope.options.extensions.join(', ') + ').');
          } else {
            //Load the Preview before uploading
            fileReader.readAsDataURL(selectedFile);
          }
        };

        scope.exportImages = function(callback) {
          var index = arguments[1];
          if (!index) index = 0;
          var keys = Object.keys(scope.options.export);
          
          if (index >= keys.length) {
            callback(); //finished exporting images
            return;
          }
          var exportKey = keys[index];
          var settings = scope.options.export[exportKey];
          scope.resizeImage(scope.imageUrl, settings, function(blob) {
            //Store resized image as a blob in __ModelFieldImageData using exportKey
            scope.modelData.__ModelFieldImageData[scope.key][exportKey] = blob;
            index++;
            scope.exportImages(callback, index);
          });
        };
        
        scope.resizeImage = function(imageUrl, settings, callback) {
          ImageService.resize(imageUrl, settings, function(error, dataUrl) {
            var blob = scope.dataURItoBlob(dataUrl);
            callback(blob);
          });
        };
        
        scope.dataURItoBlob = function(dataURI) {
          // convert base64/URLEncoded data component to raw binary data held in a string
          var byteString;
          if (dataURI.split(',')[0].indexOf('base64') >= 0)
              byteString = atob(dataURI.split(',')[1]);
          else
              byteString = unescape(dataURI.split(',')[1]);

          // separate out the mime component
          var mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];

          // write the bytes of the string to a typed array
          var ia = new Uint8Array(byteString.length);
          for (var i = 0; i < byteString.length; i++) {
              ia[i] = byteString.charCodeAt(i);
          }

          return new Blob([ia], {type:mimeString});
        };
        
        scope.imageClick = function() {
          //When user clicks the image container
          if (scope.options && scope.options.isLightbox || scope.options.isLightboxWithZoom) {
            //Display Full Screen
            var image = new Image();
            image.onload = function () {
              var $modal = $('<div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-color:rgba(0,0,0,0); z-index: 9999;"></div>');
              var $container = $('<div style="position: absolute; top: 5%; left: 5%; right: 5%; bottom: 5%; opacity: 0.0; cursor: pointer;"></div>');
              $modal.append($container);
              $("body").append($modal);

              if (scope.options.isLightbox) {
                //Lightbox only
                var scale = Math.min($container.width() / image.width, $container.height() / image.height);
                var width = image.width * scale;
                var height = image.height * scale;
                $container.css({
                  background: 'no-repeat center center url(' + scope.imageUrl + ')',
                  backgroundSize: width + 'px ' + height + 'px'
                });
              } else {
                //Lightbox with zoom capability
                var $thumbnail = $('<div style="display: inline-block; width: 30%; height: 100%;"></div>');
                var $zoom = $('<div style="display: inline-block; width: 70%; height: 100%;"></div>');
                $container.append($thumbnail);
                $container.append($zoom);
                var scale = Math.min($thumbnail.width() / image.width, $thumbnail.height() / image.height);
                var thumbnailWidth = image.width * scale;
                var thumbnailHeight = image.height * scale;
                $thumbnail.css({
                  background: 'no-repeat center center url(' + scope.imageUrl + ')',
                  backgroundSize: thumbnailWidth + 'px ' + thumbnailHeight + 'px'
                });
                var maxScale = 1.0;
                scale = maxScale;
                var zoomWidth = image.width * scale;
                var zoomHeight = image.height * scale;
                $zoom.css({
                  background: 'no-repeat center center url(' + scope.imageUrl + '), #111',
                  backgroundSize: zoomWidth + 'px ' + zoomHeight + 'px',
                  border: 'solid 1px #000'
                });
                var x = 'center';
                var y = 'center';

                var positionImage = function(event) {

                  //Handle Positioning
                  x = event.offsetX;
                  y = event.offsetY;
                  if (!x) x = event.pageX; //Firefox
                  if (!y) y = event.pageY; //Firefox

                  //calculate position on thumbnail
                  x -= $thumbnail.width()/2 - thumbnailWidth/2;
                  y -= $thumbnail.height()/2 - thumbnailHeight/2;

                  //find position to zoom to
                  x *= -zoomWidth/thumbnailWidth; //scale
                  y *= -zoomHeight/thumbnailHeight;
                  x += $zoom.width()/2; //center
                  y += $zoom.height()/2;
                  $zoom.css({
                    backgroundPosition: x + "px " + y + "px",
                    backgroundSize: zoomWidth + 'px ' + zoomHeight + 'px'
                  });
                };

                $thumbnail.on("mousemove", positionImage);
                $thumbnail.bind('mousewheel', function(event) {
                  //Handle Scaling
                  var increment = 0.01;
                  if(event.originalEvent.wheelDelta /120 > 0 && scale + increment <= maxScale * 1.1) {
                    scale += increment;
                  } else if (scale - increment >= 0.1) {
                    scale -= increment;
                  }
                  zoomWidth = image.width * scale;
                  zoomHeight = image.height * scale;
                  positionImage(event);
                });

              }
              $modal.animate({backgroundColor: "rgba(0,0,0,0.65)"}, 600, function () {
                $container.animate({opacity: 1.0}, 300);
              });
              $container.click(function () {
                $modal.animate({opacity: 0}, 300, function () {
                  $modal.remove();
                });
              });

            };
            image.src = scope.imageUrl;
          } else {
            var $imageContainer = element.find(".image-container");
            if ($imageContainer.width() <= 160) {
              $imageContainer.animate({width: "400px", height: "400px"}, 300);
            } else {
              $imageContainer.animate({width: "160px", height: "160px"}, 300);

            }
          }
        };
        
        //Prevent accidental file drop
        $document.on("drop", function(event) {
          if (event.target.nodeName != "INPUT") {
            event.preventDefault();
          } 
        });

        $document.on("dragover", function( event ) {
          event.preventDefault();
          //Show Drop Target
          element.find(".image-drop").addClass("show-upload");
          element.find(".input[type=file]").addClass("show-upload");
          element.find(".button-menu").addClass("hide-menu");
        });

        $(window).on("mouseleave", function() {
          //Hide Drop Target
          element.find(".image-drop").removeClass("show-upload");
          element.find(".input[type=file]").removeClass("show-upload");
          element.find(".button-menu").removeClass("hide-menu");
        });

        scope.$on('$destroy', function() {
          //event clean up
          $document.off("drop");
          $document.off("dragover");
          $(window).off("mouseleave");
        });

        scope.$on("removeModelFieldImage", function(event, key) {
          if (key !== scope.key) return;
          scope.clear(null, true);
        })


    }
  };
}])

;

angular.module('dashboard.directives.ModelFieldList', [
  "dashboard.Config",
  "dashboard.services.GeneralModel",
  "ui.select"
])

.directive('modelFieldListView', ['$compile', function($compile) {
  "ngInject";

  return {
    restrict: 'E',
    template: '<b>{{ options.model }}</b>: {{ data[options.key] }}',
    scope: {
      options: '=options',
      data: '=ngModel',
      required: 'ngRequired',
      disabled: 'ngDisabled'
    },
    link: function(scope, element, attrs) {
    }
  };
}])

.directive('modelFieldListEdit', ['$compile', '$cookies', '$timeout', 'Config', 'GeneralModelService', function($compile, $cookies, $timeout, Config, GeneralModelService) {
  "ngInject";

  function getTemplate(key) {
    var template = '\
    <ul ui-sortable="sortableOptions" ng-model="list" ng-show="list.length > 0"> \
      <li ng-repeat="(index, item) in list"> \
        <i class="fa fa-reorder"></i>\
        <div class="list-field-container"> \
          <div class="list-field" ng-repeat="field in options.display">\
            <input type="text" class="form-control list-edit-{{field}}" ng-model="list[index][field]" placeholder="{{options.properties[field].display.label}}", ng-change="updateData()" ng-disabled="disabled || list[index].isDisabled"> \
          </div> \
        </div> \
        <div class="action"> \
          <a href="" ng-click="removeItem(index)" class="remove" ng-hide="disabled || list[index].isDisabled"><i class="fa fa-times"></i></a> \
        </div> \
      </li> \
    </ul>\
    <button class="btn btn-default list-add-item" ng-click="addItem()" ng-disabled="disabled">{{ options.addLabel }}</button>';
    return template;
  }
  return {
    restrict: 'E',
    scope: {
      key: '=key',
      property: '=property',
      options: '=options',
      data: '=ngModel',
      modelData: '=modelData',
      disabled: '=ngDisabled'
    },
    link: function(scope, element, attrs) {

      if (!scope.list) scope.list = [];
      if (!scope.options.addLabel) scope.options.addLabel = "Add Item";

      scope.sortableOptions = {
        placeholder: 'sortable-placeholder',
        update: self.updateData,
        disabled: scope.disabled
      };

      scope.setData = function() {
        if (scope.options.output == 'object') {
          scope.data = scope.list;
        } else {
          scope.data = JSON.stringify(scope.list);
        }
      };

      scope.addItem = function() {
        event.preventDefault()
        scope.list.push({});
        scope.setData();
      };

      scope.removeItem = function(index) {
        var item = scope.list[index];
        scope.list.splice(index, 1);
        scope.setData();
      };

      scope.updateData = function() {
        scope.setData();
      };


      var unwatch = scope.$watchCollection('[data, options, modelData]', function(results) {
        if (scope.data && scope.options) {
          //unwatch(); //Don't unwatch so that updates to the scope.data outside of the directive will refresh the list
          if (scope.data instanceof Array) {
            scope.list = scope.data;
          } else {
            try {
              scope.list = JSON.parse(scope.data);
            } catch(e) {
              scope.list = [];
              console.error('ModelFieldList failed to parse scope.data', e);
            }
          }
        }
      });

      element.html(getTemplate(scope.options.key)).show();
      $compile(element.contents())(scope);

    }
  };
}])

;

angular.module('dashboard.directives.ModelFieldLocation', [
  "dashboard.services.Location",
  "ui.bootstrap",
  "dashboard.services.GeneralModel"
])
.directive('modelFieldLocationView', ['$compile', function($compile) {
  "ngInject";

  return {
    restrict: 'E',
    template: '<b>{{ options.model }}</b>: {{ data[options.key] }}',
    scope: {
      options: '=options',
      data: '=ngModel',
      required: 'ngRequired',
      disabled: 'disabled'
    },
    link: function(scope, element, attrs) {
    }
  };
}])

.directive('modelFieldLocationEdit', ['$compile', '$q', 'LocationService', function($compile, $q, LocationService) {
  "ngInject";

  //  load google maps javascript asynchronously
  function loadScript() {
    var deferred = $q.defer();
    if(angular.element('#google_maps').length ) {
      deferred.resolve();
      return deferred.promise;
    }
    var googleMapsApiJS = document.createElement('script');
    googleMapsApiJS.onload = function() {
      deferred.resolve();
    };
    googleMapsApiJS.id = 'google_maps';
    googleMapsApiJS.type = 'text/javascript';
    googleMapsApiJS.src = 'https://maps.googleapis.com/maps/api/js?v=3.exp&libraries=geometry,places';
    document.getElementsByTagName('head')[0].appendChild(googleMapsApiJS);
    return deferred.promise;
  }

  function getTemplate() {
    var template = ' \
      <div class="loading" ng-if="isMapLoading"><img src="http://www.nasa.gov/multimedia/videogallery/ajax-loader.gif" width="20" height="20" />Loading your location...</div> \
      <div ng-show="isLoaded"> \
        <div class="row">\
          <div class="cols" ng-class="{\'col-sm-5\':valueChanged,\'col-sm-6\':!valueChanged}">\
            <input id="geoPointLat" class="field form-control" placeholder="Lat" ng-model="data.lat">\
          </div>\
          <div class="cols" ng-class="{\'col-sm-5\':valueChanged,\'col-sm-6\':!valueChanged}">\
            <input id="geoPointLng" class="field form-control" placeholder="Lng" ng-model="data.lng">\
          </div>\
          <div class="cols col-sm-2" ng-show="valueChanged">\
            <button class="btn" ng-click="revertValue()" ng-disabled="!valueChanged">Revert</button>\
          </div>\
        </div>\
        <div class="map-canvas" id="map_canvas"></div>\
        <accordion close-others="oneAtATime" ng-if="showGeocode">\
          <accordion-group heading="Geocode">\
            <input class="field form-control" placeholder="Location" ng-model="geocodeSearch.value">\
            <div ng-if="geocodeError">{{geocodeError}}</div>\
            <button class="btn" ng-click="doGeocode()" ng-disabled="!geocodeSearch.value">Go</button>\
          </accordion-group>\
        </accordion>\
      </div>';
    return template;
  }

  return {
    restrict: 'E',
    require: "ngModel",
    scope: {
      key: '=key',
      property: '=property',
      options: '=options',
      data: '=ngModel',
      modelData: '=modelData',
      disabled: '=ngDisabled'
    },
    link: function(scope, element, attrs) {

      var map;
      var miles = 3;
      var userSearchInput;
      var radius = 3;
      var geocoder;
      var selectedMarker;
      var originalValue;

      scope.isMapLoading = true;
      scope.isLoaded = false;
      scope.geocodeSearch = {value:''};
      scope.geocodeError = null;
      scope.showGeocode = false;

      loadScript().then(function () {

          geocoder = new google.maps.Geocoder();

          scope.showGeocode = false;
          if(scope.property.display.options && scope.property.display.options.allowGeocode ) {
            scope.showGeocode = true;
          }

          var query = '';
          if(scope.property.display.options && scope.property.display.options.query ) {
            query = scope.property.display.options.query;
          }

          //  Render template
          element.html(getTemplate()).show();
          $compile(element.contents())(scope);

          //  If there is a value for this field, show a marker for it,
          //  otherwise geolocate the user using browser's location api
          if(scope.data) {
            originalValue = scope.data;
            scope.location = angular.copy(scope.data);
            initMap();
          } else {
            //Currently calls LocationService to get user's current location
            LocationService.currentLocation().then(function (position) {
                var pointLocation = {
                  lat: position.latitude,
                  lng: position.longitude
                };
                originalValue = pointLocation;
                scope.data = pointLocation;
                initMap();
              });
          }

          //  Watch for changes to field value and update corresponding map marker
          scope.$watch('data',function(newVal,oldVal){
            if(newVal!=oldVal) {
              scope.valueChanged = JSON.stringify(scope.data)!=JSON.stringify(originalValue);
              initSelectedMarker();
            }
          });

          scope.$watch('data.lat',function(newVal,oldVal){
            if(newVal!=oldVal) {
              scope.valueChanged = JSON.stringify(scope.data)!=JSON.stringify(originalValue);
              initSelectedMarker();
            }
          });

          scope.$watch('data.lng',function(newVal,oldVal){
            if(newVal!=oldVal) {
              scope.valueChanged = JSON.stringify(scope.data)!=JSON.stringify(originalValue);
              initSelectedMarker();
            }
          });

      }, function () {
          console.error("Error loading Google Maps")
      });

      function initMap() {
        scope.isMapLoading = false;
        scope.isLoaded = true;
        map = new google.maps.Map(angular.element('#map_canvas')[0], {
          center: scope.location,
          zoom: 12
        });
        initialize();
      }

      function initialize() {
        initSelectedMarker();
      }

      scope.doGeocode = function() {
        scope.geocodeError = null;
        if (!scope.geocodeSearch.value) {
          // May need to implement better error handling
          alert('Please enter the address of a location to geocode.');
        } else {
          geocoder.geocode({
            'address': scope.geocodeSearch.value
            }, function(results, status) {
              if (status == google.maps.GeocoderStatus.OK) {
                scope.$apply(function() {
                   var LatLng = {
                    lat: results[0].geometry.location.lat(),
                    lng: results[0].geometry.location.lng()
                 };
                 scope.data = LatLng;
                 initMap();
                });
              } else if (status === google.maps.GeocoderStatus.OVER_QUERY_LIMIT) {
                  console.log("Geocode was not successful for the following reason: " + status);
              } else if (status === google.maps.GeocoderStatus.ZERO_RESULTS) {
                  scope.geocodeError = "Couldn't match the specified query with a geopoint";
                  scope.$digest();
                  console.log("Geocode was not successful for the following reason: " + status);
              } else {
                console.log("Geocode was not successful for the following reason:" + status);
              }
            });
        }
      }

      function initSelectedMarker() {
        //update marker
        if(scope.data) {
          if(!selectedMarker) {
            var pinColor = "2F76EE";
            selectedMarker = new google.maps.Marker({
              position: scope.location,
              map: map,
              icon: new google.maps.MarkerImage("http://chart.apis.google.com/chart?chst=d_map_pin_letter&chld=%E2%80%A2|" + pinColor,
                  new google.maps.Size(21, 34),
                  new google.maps.Point(0,0),
                  new google.maps.Point(10, 34)),
              draggable: true,
              tooltip: "Current location"
            });
            google.maps.event.addListener(selectedMarker, 'dragend', function() {
              var LatLng = {
                  lat: selectedMarker.position.lat(),
                  lng: selectedMarker.position.lng()
               };
              scope.data = LatLng;
              scope.$digest();
            });
          } else {
            var LatLng = new google.maps.LatLng(scope.data.lat,scope.data.lng);
            selectedMarker.setPosition(LatLng);
            selectedMarker.setMap(map)
            map.setCenter(LatLng);
          }
        }
      }

      scope.clearSearch = function() {
        scope.hasSearched = false;
      }

      scope.revertValue = function() {
        if( originalValue ) scope.data = originalValue;
      }
    }
  };
}])

;

angular.module('dashboard.directives.ModelFieldMultiSelect', [])

.directive('modelFieldMultiSelect', ['$compile', '$timeout', function($compile, $timeout) {
  "ngInject";

  function getTemplate() {
    var template =
      '<div class="select-item checkbox-container" ng-repeat="item in multiSelectOptions">' +
        '<input type="checkbox" class="field" ng-attr-id="{{key+\'-\'+$index}}" ng-model="selected[$index]" ng-checked="selected[$index]" ng-disabled="disabled" ng-change="clickMultiSelectCheckbox($index, item)">' +
        '<label class="checkbox-label" ng-attr-for="{{key+\'-\'+$index}}">{{ item.value }}</label>' +
      '</div>';
    return template;
  }

  return {
    restrict: 'E',
    require: "ngModel",
    scope: {
      key: '=key',
      property: '=property',
      options: '=options',
      data: '=ngModel',
      modelData: '=modelData',
      disabled: '=ngDisabled',
      ngBlur: '&',
    },
    link: function(scope, element, attrs, ngModel) {
      
      var property = scope.property;
      var hasDataChanged;
      
      function init() {
        scope.multiSelectOptions = [];
        scope.selected = [];
        if (!property) property = {};
        if (!property.display) property.display = {};

        initOptions();
        initData();

        //Handle translating multi-select checks to scope.data output format
        scope.clickMultiSelectCheckbox = clickMultiSelectCheckbox;

        element.html(getTemplate()).show();
        $compile(element.contents())(scope);

        scope.$on('removeModelFieldMultiSelect', function($event, key) {
          if (key !== scope.key) return;
          $timeout(function() {
            initData();
          }, 1)
        })
      }

      /**
       * parses multi-select options and checks if string, array, or object
       * if string - try parsing first based on new line character; if no new-line character assume comma separated
       * if array - check if array of string values or array of key/value pair objects
       * if object - parse as key/value pair object ordered by key
       */
      function initOptions() {
        var options = scope.options || property.display.options;
        if (typeof options === 'string') {
          //Check if options on new line
          if (options.indexOf('\n') > -1) {
            //Options separated by new line
            options = options.split('\n');
          } else {
            //assume options separated by comma
            options = options.split(',');
          }
        }

        var keyOverride = property.display.key || 'key';
        var valueOverride = property.display.value || 'value';
        if (Array.isArray(options)) {
          //Check if array of strings
          for (var i in options) {
            var item = options[i];
            if (typeof item === 'string') {
              //string option
              var option = {key: item, value: item};
              scope.multiSelectOptions.push(option);
            } else if (item && typeof item === 'object') {
              //Objects (key/value pair)
              var key = item[keyOverride] || i; //fallback to index if no key
              var option = { key: key, value: item[valueOverride], item: item };
              scope.multiSelectOptions.push(option);
            }
          }

        } else if (options && typeof options === 'object') {
          //Assume object containing key/value pair
          var keys = Object.keys(options);
          for (var k in keys) {
            var key = keys[k];
            var option = { key: key, value: options[key] };
            scope.multiSelectOptions.push(option);
          }
        }
      }

      /**
       * Initial data load by checking desired output as comma, array, or object
       */
      function initData() {
        // reset all to false - used to rebuild data if revert is required
        for (var k in scope.selected) {
          scope.selected[k] = false
        };
        if (typeof property.display.output === 'undefined') {
          var options = scope.options || property.display.options;
          property.display.output = options instanceof Array ? "comma" : "object";
        }
        if (typeof scope.data === 'string') {
          if (!scope.data) scope.data = "";
          var items = scope.data.split('","');
          for (var i in items) {
            var item = items[i];
            if (item[0] == '"') item = item.substring(1, item.length);
            if (item[item.length-1] == '"') item = item.substring(0, item.length-1);
            var index = _.findIndex(scope.multiSelectOptions, {key: item});
            if (index > -1) scope.selected[index] = true;
          }
        } else if (Array.isArray(scope.data)) {
          if (!scope.data) scope.data = [];
          for (var i in scope.data) {
            var value = scope.data[i];
            var index = _.findIndex(scope.multiSelectOptions, {key: value});
            if (index > -1) scope.selected[index] = true;
          }
        } else if (scope.data && typeof scope.data === 'object') {
          if (!scope.data) scope.data = {};
          var keys = Object.keys(scope.data);
          for (var k in keys) {
            var key = keys[k];
            var index = _.findIndex(scope.multiSelectOptions, {key: key});
            if (index > -1) scope.selected[index] = true;
          }
        }
      }

      function clickMultiSelectCheckbox(index, selectedOption) {
        hasDataChanged = true;
        var output = property.display.output === 'array' ? [] : property.display.output === 'object' ? {} : '';

        for (var i in scope.selected) {
          if (scope.selected[i]) {
            var option = scope.multiSelectOptions[i];
            switch (property.display.output) {
              case 'object':
                output[option.key] = option.value;
                break;
              case 'comma':
                output += '"' + option.key + '",'; //quote qualified
                break;
              case 'array':
                output.push(selectedOption.item || selectedOption.key); // return array
                break;
            }

          }
        }

        if (property.display.output === 'comma' && output.length > 0) output = output.substring(0, output.length-1); //remove last comma

        scope.data = output;

        // asynchronous behavior because moving data up chain
        setTimeout(function() {
          if (scope.ngBlur && hasDataChanged) {
            scope.ngBlur({key: scope.key})
          }
          hasDataChanged = false
        // this may cause a non optimal user experience, but reducing ability to bypass the check
        }, 1);

        // Note: breaking changes on onModelFieldMultiSelectCheckboxClick emit below after Angular 1.6.4 upgrade
        // due to ModelFieldMultiSelect rewrite
        //scope.$emit('onModelFieldMultiSelectCheckboxClick', scope.key, selectedOption, selected);
      }

      init();
    }
  };
}])

;

angular.module('dashboard.directives.ModelFieldNumber', [])

.directive('modelFieldNumber', ['$compile', '$filter', function($compile, $filter) {
  "ngInject";

  function getTemplate() {
    var template =
      '<input type="{{property.display.allowDecimal ? \'text\' : \'number\'}}" ng-class="{error: property.display.error.length > 0}" ng-keyup="checkNumber($event)" ng-blur="validateAndParseNumbers($event)" min="{{ property.display.minValue }}" max="{{ property.display.maxValue }}" ng-model="data" ng-disabled="disabled" ng-required="required" class="field form-control">';
    return template;
  }

  return {
    restrict: 'E',
    require: "ngModel",
    scope: {
      key: '=key',
      property: '=property',
      options: '=options',
      data: '=ngModel',
      modelData: '=modelData',
      disabled: '=ngDisabled',
      required: '=ngRequired',
      ngError: '&',
      ngEditReason: '&',
    },
    link: function(scope, element, attrs, ngModel) {

      var property = scope.property;
      var promise;
      var hasDataChanged;

      function init() {

        if (!property) property = {};
        if (!property.display) property.display = {};
        if (typeof property.display.scaleValue === 'undefined') property.display.scaleValue = 0;
        scope.checkNumber = checkNumber;
        scope.validateAndParseNumbers = validateAndParseNumbers;

        if (property.display.allowDecimal === true && property.display.scaleValue > 0) {
          scope.data = $filter('decimalWithScale')(scope.data, property.display.scaleValue);
        }

        element.html(getTemplate()).show();
        $compile(element.contents())(scope);
      }

      /**
       * On keypress check the input and limit decimal scale value
       * @param event
       */
      function checkNumber(event) {
        hasDataChanged = true;

        //Get current cursor input position
        var cursorPosition = 0;
        if (document.selection) {
          //IE support
          var range = document.selection.createRange();
          range.moveStart('character', -event.target.value.length);
          cursorPosition = range.text.length;
        } else if (event.target.selectionStart || event.target.selectionStart === 0) {
          cursorPosition = event.target.selectionStart;
        }

        var value = event.target.value;
        if (typeof value !== 'string') return;
        var indexOfDecimal = value.indexOf('.');
        if (indexOfDecimal === -1 || indexOfDecimal >= cursorPosition) return; //only strict if entering decimal
        var valueComponents = value.split('.');
        if (valueComponents.length < 1) return;
        if (valueComponents[1].length >= property.display.scaleValue) {
          event.preventDefault();
          return;
        }
      }

      /**
       * Validate the input on blur
       * @param e
       */
      function validateAndParseNumbers(e) {
        // this logic is to to handled required
        if ((e.target.value === '' || e.target.value === null) && !e.target.validity.badInput) { /*validity states lets us know if it's actually a bad value - target.value also returnes empty string */
          if (scope.ngError && property.display.isRequired) {
            scope.ngError({error: new Error('This is a required field.')});
          } else if (scope.ngError) {
            scope.ngError({error: null});
          }
          if (scope.ngEditReason && hasDataChanged) {
            scope.ngEditReason({key: scope.key})
          }
          return
        }

        if (property.display.allowDecimal === true && property.display.scaleValue > 0) {
          var decimalString = $filter('decimalWithScale')(e.target.value, property.display.scaleValue);
          if (isNaN(decimalString) && scope.ngError) {
            scope.ngError({error: new Error('Please enter a valid number')});
            return
          } else {
            scope.data = decimalString; /*scope.data.scale is to handle parsing the field while scale data is being entered - formEdit */
          }
          if (property.display.minValue !== undefined && isFirstDecLarger(property.display.minValue, e.target.value)) {
            if (scope.ngError) scope.ngError({error: new Error('Value is less than the minimum allowed value (' + property.display.minValue + ').')});
            return
          }
          if (property.display.maxValue !== undefined && isFirstDecLarger(e.target.value, property.display.maxValue)) {
            if (scope.ngError) scope.ngError({error: new Error('Value is greater than the maximum allowed value (' + property.display.maxValue + ').')});
            return
          }
          if (scope.ngError) scope.ngError({error: null});
        } else if (property.display.allowDecimal === false) { /*handle when don't allow decimals - needs to be explicitly implied*/
          if (isNaN(_.round(e.target.value)) || isNaN(parseInt(e.target.value))) {
            if (scope.ngError) scope.ngError({error: new Error('Please enter a valid number')});
            return
          }
          var roundedValue = _.round(e.target.value, 0);
          scope.data = roundedValue;
          if (property.display.minValue !== undefined && property.display.minValue > parseFloat(e.target.value)) {
            if (scope.ngError) scope.ngError({error: new Error('Value is less than the minimum allowed value (' + property.display.minValue + ').')});
            return
          }
          if (property.display.maxValue !== undefined && property.display.maxValue < parseFloat(e.target.value)) {
            if (scope.ngError) scope.ngError({error: new Error('Value is greater than the maximum allowed value (' + property.display.maxValue + ').')});
            return
          }
          if (scope.ngError) scope.ngError({error: null});
        }

        if (scope.ngEditReason && hasDataChanged) {
          scope.ngEditReason({key: scope.key})
        }
        hasDataChanged = false
      }

      /**
       * Takes two decimals as string and returns true if first is strictly larger than second
       * @param dec1 - string representation of decimal - decimal separated, must have leading 0 if absolute value less than 1
       * @param dec2 - string representation of decimal - decimal separated, must have leading 0 if absolute value less than 1
       */
      function isFirstDecLarger(dec1, dec2) {
        dec1 = $filter('decimalWithScale')(dec1, property.display.scaleValue);
        dec2 = $filter('decimalWithScale')(dec2, property.display.scaleValue);
        if (isNaN(dec1)|| isNaN(dec2)) return;
        var dec1Components = dec1.split('.');
        var dec2Components = dec2.split('.');
        if (parseInt(dec1Components[0]) > parseInt(dec2Components[0])) {
          return true
        } else if (parseInt(dec1Components[0]) < parseInt(dec2Components[0])) {
          return false
        } else { /*equal so look at decimal spots */
          var areBothPositive = (parseInt(dec1Components[0]) >= 0 && parseInt(dec2Components[0]) >= 0)
          for (var i = 0; i < Math.max(dec1Components[1].length, dec2Components[1].length); i++) {
            if (dec1Components[1].charAt(i) === '') dec1Components[1] += '0';
            if (dec2Components[1].charAt(i) === '') dec2Components[1] += '0';
            if (parseInt(dec1Components[1].charAt(i)) > parseInt(dec2Components[1].charAt(i))) {
              return areBothPositive;
            } else if (parseInt(dec1Components[1].charAt(i)) < parseInt(dec2Components[1].charAt(i))) {
              return !areBothPositive;
            }
          }
        }
      };

      init();
    }
  };
}])

;

angular.module('dashboard.directives.ModelFieldPointsOfInterest', [
	'dashboard.Dashboard.Model.Edit.SaveDialog',
	"dashboard.Config",
	"dashboard.services.Location",
	"ui.bootstrap",
	"dashboard.services.GeneralModel",
	"ui.select"
])

.directive('modelFieldPointsOfInterestView', ['$compile', function($compile) {
  "ngInject";

	return {
		restrict: 'E',
		template: '<b>{{ options.model }}</b>: {{ data[options.key] }}',
		scope: {
			options: '=options',
			data: '=ngModel',
			required: 'ngRequired',
			disabled: 'disabled'
		},
		link: function(scope, element, attrs) {
		}
	};
}])

.directive('modelFieldPointsOfInterestEdit', ['$compile', '$cookies', '$timeout', '$http', '$q', '$window', 'Config', 'GeneralModelService', 'LocationService', function($compile, $cookies, $timeout, $http, $q, $window, Config, GeneralModelService, LocationService) {
  "ngInject";

	//  load google maps javascript asynchronously
	function loadScript(googleApiKey) {
		var deferred = $q.defer();
		if(angular.element('#google_maps').length ) {
			deferred.resolve();
			return deferred.promise;
		}
		var googleMapsApiJS = document.createElement('script');
		googleMapsApiJS.onload = function() {
				deferred.resolve();
		};
		googleMapsApiJS.id = 'google_maps';
		googleMapsApiJS.type = 'text/javascript';
		googleMapsApiJS.src = 'https://maps.googleapis.com/maps/api/js?v=3.exp&libraries=geometry,places';
		if (googleApiKey) googleMapsApiJS.src += '&key=' + googleApiKey;
		document.getElementsByTagName('head')[0].appendChild(googleMapsApiJS);
		return deferred.promise;
	}

	// makes the string lowercase and converts spaces into underscore
	function convertStringToGoogleTypeFormat(str) {
		return str.replace(/ /g,"_").toLowerCase();
	}

	function getTemplate() {
		var repeatExpression = 'item in displayedSearchResults track by item.id';
		var template = ' \
			<div class="loading" ng-if="isMapLoading"><i class="fa fa-spin fa-spinner"></i>Search results are loading...</div> \
			<div ng-show="isLoaded"> \
			<accordion close-others="oneAtATime"> \
			<accordion-group class="accordion-group" heading="Location Search" is-open="true"> \
			<input id="zipCode" class="field form-control" placeholder="Zip Code" ng-model="data.zipCode">\
			<input id="searchInput" class="field form-control" placeholder="Search Location" ng-model="request[\'query\']">\
			 <select id="radius" ng-model="data.radius" ng-required="" class="field form-control ng-pristine ng-valid ng-valid-required" ng-disabled=""> \
				 <option value="1" label="1 Mile">1 Mile</option> \
				 <option value="2" label="2 Miles">2 Miles</option> \
				 <option value="3" label="3 Miles" selected>3 Miles</option> \
				 <option value="5" label="5 Miles">5 Miles</option> \
				 <option value="10" label="10 Miles">10 Miles</option> \
				 <option value="20" label="20 Miles">20 Miles</option> \
				 <option value="30" label="30 Miles">30 Miles</option> \
			 </select> \
			<button class="btn btn-default" ng-click="doSearch()" ng-model="request.query">Search</button><span class="search-error" ng-if="searchError">{{searchError}}</span>\
			</accordion-group>\
			</accordion> \
			<div class="map-canvas"id="map_canvas"></div> \
			<ul class="selected-location" ng-model="displayedSearchResults" > \
				<li ng-repeat="'+repeatExpression+'" ng-click="updateSelection($index, displayedSearchResults)"> \
					<div class="location-title">{{ $index + 1 }}. {{ item.name }}</div> \
						<span class="search-results">{{item.formatted_address}}</span> \
					<div class="col-sm checkbox-container">\
						<input type="checkbox" ng-attr-id="{{item.place_id}}" ng-model="item.checked" class="field"> \
						<label class="checkbox-label" ng-attr-for="{{item.place_id}}" ></label> \
					</div> \
				</li> \
			</ul>';
		return template;
	}

	return {
		restrict: 'E',
		require: "ngModel",
		scope: {
			key: '=key',
			property: '=property',
			options: '=options',
			data: '=ngModel',
			modelData: '=modelData',
			disabled: '=ngDisabled'
		},
		link: function(scope, element, attrs) {

			var map;
			var milesToMeters = 1609.34;           // Conversion to miles to meters
			var miles = 3;
			var geocoder;
			var radius = miles * milesToMeters;
			var zoom;
			var markerLocation;
			var infowindow;
			var requestQuery;
			var perviouslySavedLatLng;

			scope.circle = {};                     // displayed cicle boundary
			scope.markers = [];                    // Stored markers
			scope.boundaries = [];                 // Stored google boundary circles
			scope.searchResults = [];              // All data recieved from query
			scope.displayedMarkers = [];           // Markers that match query
			scope.displayedSearchResults = [];     // Data for location list
			scope.isMapLoading = true;
			scope.isLoaded = false;
			scope.placeType = scope.property.display.options.placeType; //Default query value
			scope.googleApiKey = scope.property.display.options.googleApiKey;
			scope.googleType = [convertStringToGoogleTypeFormat(scope.placeType)];
			if (!scope.data) scope.data = {};
			if (scope.property.display.zipCode) scope.data.zipCode = scope.property.display.zipCode; //pass in zip code if available

			//Check if scope.data is JSON string and try to parse it to load the data
			if (scope.data && typeof scope.data === 'string') {
				try {
					scope.data = JSON.parse(scope.data);
				} catch (e) {
					console.error(e);
					scope.data = {};
				}
			}
			if (!scope.data.radius) scope.data.radius = miles;

			loadScript(scope.googleApiKey).then(function () {
				console.log('scope.data', scope.data);
				geocoder = new google.maps.Geocoder();
				infowindow = new google.maps.InfoWindow();
				if(scope.data.query) {
					requestQuery = scope.data.query;
				} else {
					requestQuery = scope.placeType;
				}
				scope.request = {
					radius: radius,
					query: requestQuery,
					type: scope.googleType
				};

				element.html(getTemplate()).show();
				$compile(element.contents())(scope);
				/**
				 * Disabled browser geolocation
				 */
				//Checked for saved coordinates
				// if(!scope.data.lat && !scope.data.lng) {
				// 	//Initial search with user's location
				// 	LocationService.currentLocation().then(function (position) {
				// 		var pointLocation = {
				// 			lat: position.latitude,
				// 			lng: position.longitude
				// 		};
				// 		zoom = 12;
				// 		scope.request.location = pointLocation;
				// 		scope.reverseGeocode(pointLocation);
				// 		initMap();
				// 	}, function () {
				// 		//Use default location
				// 		var defaultLocation = {
				// 			lat: 39.833333,
				// 			lng: -98.583333
				// 		};
				// 		zoom = 4;
				// 		scope.request.location = defaultLocation;
				// 		scope.reverseGeocode(defaultLocation);
				// 		initMap();
				// 	});
				// } else {
				// 	var savedLocation = {
				// 		lat: scope.data.lat,
				// 		lng: scope.data.lng
				// 	};
				// 	zoom = 12;
				// 	scope.request.location = savedLocation;
				// 	initMap();
				// }

				scope.isMapLoading = false;
				scope.isLoaded = true;
				scope.doSearch();

			}, function () {
				console.error("Error loading Google Maps")
			});

			function initMap() {
				scope.isMapLoading = false;
				scope.isLoaded = true;
				map = new google.maps.Map(document.getElementById('map_canvas'), {
					center: scope.request.location,
					zoom: zoom
				});
				initialize();
			}

			function initialize() {
				initQuery();
			}
			// Search is initialized once user presses search button
			scope.doSearch = function () {
				scope.searchError = null;
				scope.data.query = scope.request.query;
				scope.request.radius = scope.data.radius * milesToMeters;
				var zipCode = scope.data.zipCode;
				if (!zipCode || zipCode.length !== 5) {
					scope.searchError = 'Your Zip Code is invalid!';
				} else {
					geocoder = new google.maps.Geocoder();
					geocoder.geocode({
						'address': zipCode
					}, function (results, status) {
						if (status == google.maps.GeocoderStatus.OK) {
							scope.$apply(function () {
								var LatLng = {
									lat: results[0].geometry.location.lat(),
									lng: results[0].geometry.location.lng()
								};
								scope.request.location = LatLng;
								scope.reverseGeocode(LatLng);
								initMap();
							});
						} else if (status === google.maps.GeocoderStatus.OVER_QUERY_LIMIT) {
							console.log("search was not successful for the following reason: " + status);
						} else {
							console.log("search was not successful for the following reason:" + status);
						}
					});
				}
			};

			function initQuery() {
				scope.clearSearch();

				/*  DEV NOTES: Hack to ensure that most all results fall within our original radius
				 TEXT SEARCH URL: https://developers.google.com/maps/documentation/javascript/places#place_search_responses
				 DOCUMENTATION: "You may bias results to a specified circle by passing a location and a radius parameter.
				 Results outside the defined area may still be displayed!"    - Google Maps */
				var request = jQuery.extend(true, {}, scope.request);
				request.radius = 0.5*request.radius;

				var service = new google.maps.places.PlacesService(map);
				service.textSearch(request, function(results, status) {
					if (status == google.maps.places.PlacesServiceStatus.OK) {
						createMarkers(results);
						if (scope.boundaries.length > 0) {
							clearOverlays();
						}
						if (scope.markers.length > 0) {
							removeMarkers();
						}
						createCircle();
						displayMarkers();
						listSearchResults();
						scope.$digest();
					} else {
						console.log("search was not successful for the following reason: " + status);
					}
				});
			}

			scope.reverseGeocode = function (coordinates) {
				geocoder = new google.maps.Geocoder();
				geocoder.geocode({'location': coordinates}, function (results, status) {
					if (status === google.maps.GeocoderStatus.OK) {
						if (results[0]) {
							var resultPlaceId = {
								placeId: results[0].place_id
							};
							scope.getAdditionPlaceInformation(resultPlaceId);
						} else {
							console.log("search was not successful for the following reason: " + status);
						}
					} else {
						console.log("search was not successful for the following reason: " + status);
					}
				});
			};

			function createMarkers(results) {
				if (infowindow) {
					infowindow.close();
				}
				for (var i = 0; i < results.length; i++) {
					scope.searchResults.push(results[i]);
					var text = "Location:  " + results[i].name;
					var marker = new google.maps.Marker({
						map: map,
						position: results[i].geometry.location,
					});
					google.maps.event.addListener(marker, 'click', (function(marker, text) {
						return function() {
							markerLocation = marker.getPosition();
							infowindow.setContent(text);
							infowindow.open(map, marker);
							scope.getClickedMarker(markerLocation);
						}
					})(marker, text));
					scope.markers.push(marker);
				}
			}

			function removeMarkers() {
				for (var i = 0; i < scope.markers.length; i++) {
					scope.markers[i].setMap(null);
				}
			}

			function createCircle() {
				// circle for display
				scope.circle = new google.maps.Circle({
					center: scope.request.location,
					radius: scope.request.radius,
					fillOpacity: 0.15,
					fillColor: "#FF0000",
					map: map
				});
				scope.boundaries.push(scope.circle);
			}

			function displayMarkers() {
				var bounds = new google.maps.LatLngBounds(); // Set initial bounds for markers
				for (var i = 0; i < scope.markers.length; i++) {
					var marker = scope.markers[i];
					var distance = google.maps.geometry.spherical.computeDistanceBetween(marker.getPosition(), scope.circle.center);
					if (distance < scope.request.radius) {
						bounds.extend(marker.getPosition());
						scope.displayedMarkers.push(marker);
						// Display markers
						marker.setMap(map);
					} else {
						// Hide the markers outside of the boundary
						marker.setMap(null);
					}
				}

				map.fitBounds(bounds);
				if (scope.displayedMarkers.length == 0) {
					scope.searchError = "Couldn't find any locations matching the search criteria!";
				}
			}

			function listSearchResults() {
				for (var i = 0; i < scope.searchResults.length; i++) {
					var result = scope.searchResults[i];
					var distance = google.maps.geometry.spherical.computeDistanceBetween(result.geometry.location, scope.circle.center);
					if (distance < scope.request.radius) {
						//Adds correct results to list view
						scope.displayedSearchResults.push(result);
					}
				}
				if (scope.data.placeId) { // pre-select point if exist
					perviouslySavedLatLng = new google.maps.LatLng(scope.data.lat, scope.data.lng);
					scope.getClickedMarker(perviouslySavedLatLng);
				}
			}

			function clearOverlays() {
				for (var i = 0; i < scope.boundaries.length; i++) {
					scope.boundaries[i].setMap(null);
					scope.boundaries.length = 0;
				}
			}

			scope.getClickedMarker = function(markerLocation) {
				if(scope.displayedSearchResults) {
					for(var i = 0; i < scope.displayedSearchResults.length; i++) {
						if(google.maps.geometry.spherical.computeDistanceBetween(markerLocation, scope.displayedSearchResults[i].geometry.location) == 0) {
							scope.displayedSearchResults[i].checked = true;
							scope.getSelectResultData(scope.displayedSearchResults[i]);
						} else {
							scope.displayedSearchResults[i].checked = false;
						}
					}
					scope.$digest();
				}
			};

			scope.clearSearch = function () {
				removeMarkers();
				clearOverlays();
				scope.searchResults = [];
				scope.displayedMarkers = [];
				scope.displayedSearchResults = [];
				scope.markers = [];
			};

			scope.getAdditionPlaceInformation = function (placeRequest) {
				service = new google.maps.places.PlacesService(map);
				service.getDetails(placeRequest, function(place, status) {
					if (status == google.maps.places.PlacesServiceStatus.OK) {
						if(place.address_components) {
							for(var i = 0; i < place.address_components.length; i++) {
								if(place.address_components[i].types[0] == "postal_code") {
									scope.data.zipCode = place.address_components[i].short_name;
								}
							}
						}
						scope.data.phoneNumber = place.formatted_phone_number;
					} else {
						console.log('The selection made does not exist');
					}
				})
			};

			scope.getSelectResultData = function (item) {
				if (item) {
					var placeRequest = {
						placeId: item.place_id
					};
					scope.data.address = item.formatted_address;
					scope.data.lat = item.geometry.location.lat();
					scope.data.lng = item.geometry.location.lng();
					scope.data.name = item.name;
					scope.data.placeId = placeRequest.placeId;
					//Calls getDetails to get extra information
					scope.getAdditionPlaceInformation(placeRequest);
				}
			};

			scope.updateInfoWindow = function(checkedLocation) {
				var text = "Location:  " + checkedLocation.name;
				var marker = new google.maps.Marker({
					map: map,
					position: checkedLocation.geometry.location
				});
				infowindow.setContent(text);
				infowindow.open(map, marker);
			};
			// Prevents more than one checkbox at a time
			scope.updateSelection = function (selectedIdx, displayedSearchResults) {
				angular.forEach(displayedSearchResults, function (item, index) {
					if (selectedIdx != index) {
						item.checked = false;
					} else {
						item.checked = true;
						scope.updateInfoWindow(item);
						scope.getSelectResultData(item);
					}
				});
			};
		}
	};
}])

;

angular.module('dashboard.directives.ModelFieldReference', [
  "dashboard.Config",
  "dashboard.services.GeneralModel",
  "ui.select"
])

.directive('modelFieldReferenceView', ['$compile', function($compile) {
  "ngInject";

  return {
    restrict: 'E',
    template: '<b>{{ options.model }}</b>: {{ data[options.key] }}',
    scope: {
      options: '=options',
      data: '=ngModel',
      required: 'ngRequired',
      disabled: 'ngDisabled'
    },
    link: function(scope, element, attrs) {
    }
  };
}])

.directive('modelFieldReferenceEdit', ['$compile', '$cookies', 'Config', 'GeneralModelService', function($compile, $cookies, Config, GeneralModelService) {
  "ngInject";

  function getTemplate(multiple, matchTemplate, choiceTemplate) {
    var template = '';
    if (multiple) {
      //multi-select
      template = '\
      <ui-select multiple ng-model="selected.items" on-select="onSelect($item, $model)" on-remove="onRemove($item, $model)"  ng-disabled="disabled"> \
      <ui-select-match placeholder="{{ options.placeholder }}">'+ matchTemplate +'</ui-select-match> \
      <ui-select-choices repeat="item in list" refresh="refreshChoices($select.search)" refresh-delay="200">' + choiceTemplate + '</ui-select-choices> \
      </ui-select>';
    } else {
      //single-select
      template = '\
      <ui-select ng-model="selected.item" on-select="onSelect($item, $model)" ng-required="ngRequired" ng-disabled="disabled" append-to-body="{{appendToBody}}"> \
      <ui-select-match ng-click="refreshChoices($select.search);" placeholder="{{ options.placeholder }}">'+ matchTemplate +'</ui-select-match> \
      <ui-select-choices repeat="item in list" refresh="refreshChoices($select.search)" refresh-delay="200">' + choiceTemplate + '</ui-select-choices> \
      </ui-select>';
    }
    return template;
  }
  return {
    restrict: 'E',
    scope: {
      key: '=key',
      property: '=property',
      options: '=options',
      data: '=ngModel',
      modelData: '=modelData',
      disabled: '=ngDisabled',
      rowData: "=ngRowData", //for use in the model list edit mode
      textOutputPath: '=ngTextOutputPath', //output the selected text to this path in the rowData
      onModelChanged: "&onModelChanged",
      appendToBody: "=appendToBody",
      ngBlur: '&',
    },
    link: function(scope, element, attrs) {

      scope.moment = moment;
      scope.isFirstTimeLoad = true;
      scope.selected= {};
      scope.selected.items = []; //for multi-select
      scope.selected.item = null; //for single select; initialize to null so placeholder is displayed
      scope.list = [];

      scope.$watch('selected', function(newData, oldData) {
        var hasClass = element.hasClass('ng-invalid');
        var newValue = (scope.options && scope.options.multiple) ? newData.items : newData.item;
        var oldValue = (scope.options && scope.options.multiple) ? oldData.items : oldData.item;
        if (!newValue || newValue.length <= 0) {
          if ((scope.property) && (scope.property.required || (scope.property.display && scope.property.display.required))) {
            element.addClass('ng-invalid');
          }
        } else if(hasClass) {
          element.removeClass('ng-invalid');
        }
        newValue = (_.isPlainObject(newValue) && newValue[scope.options.key]) ? newValue[scope.options.key] : newValue;
        oldValue = (_.isPlainObject(oldValue) && oldValue[scope.options.key]) ? oldValue[scope.options.key] : oldValue;
        scope.$emit('onModelFieldReferenceChange', (scope.options.relationship)? scope.options.relationship : scope.key, newValue, oldValue);
      }, true);

      function replaceSessionVariables(string) {
        if (typeof string !== 'string') return string;
        try {
          //Look for session variables in string
          var session = JSON.parse($cookies.get('session')); //needed for eval() below
          var searchString = "{session.";
          var startPos = string.indexOf(searchString);
          while (startPos > -1) {
            var endPos = string.indexOf("}", startPos);
            if (endPos == -1) {
              console.error("ModelList session parsing malformed for string");
              break;
            }
            var sessionKey = string.substring(startPos+1, endPos);
            string = string.slice(0, startPos) + eval(sessionKey) + string.slice(endPos+1);
            startPos = string.indexOf(searchString);
          }
          //Look for model data variable strings
          searchString = "{";
          startPos = string.indexOf(searchString);
          while (startPos > -1) {
            var endPos = string.indexOf("}", startPos);
            if (endPos == -1) {
              console.error("ModelList session parsing malformed for string");
              break;
            }
            var key = string.substring(startPos+1, endPos);
            string = string.slice(0, startPos) + scope.modelData[key] + string.slice(endPos+1);
            startPos = string.indexOf(searchString);
          }
        } catch(e) {
          console.error(e);
        }
        return string;
      }

      /**
       * Merge arrays and filter out duplicates
       * @param fromArray
       * @param toArray
       */
      function mergeArray(fromArray, toArray) {
        for (var i in fromArray) {
          var item = fromArray[i];
          var index = toArray.indexOf(item);
          if (index == -1) toArray.push(item);
        }
      }

      scope.refreshChoices = function(search) {
        var model = Config.serverParams.models[scope.options.model];
        var params = { 'filter[limit]': 100 }; //limit only 100 items in drop down list
        params['filter[where]['+scope.options.searchField+'][like]'] = "%" + search + "%";
        if (scope.options.where) {
          //Add additional filtering on reference results
          var keys = Object.keys(scope.options.where);
          for (var i in keys) {
            var key = keys[i];
            params['filter[where][' + key + ']'] = replaceSessionVariables(scope.options.where[key]);
          }
        }
        if (scope.options.filters) {
          var keys = Object.keys(scope.options.filters);
          for (var i in keys) {
            var key = keys[i];
            params[key] = replaceSessionVariables(scope.options.filters[key]);
          }
        }
        var apiPath = model.plural;
        if (scope.options.api) apiPath = replaceSessionVariables(scope.options.api);
        GeneralModelService.list(apiPath, params, {preventCancel: true}).then(function(response) {
          if (!response) return; //in case http request was cancelled by newer request
          scope.list = response;
          if (scope.options.allowInsert) {
            var addNewItem = {};
            addNewItem[scope.options.searchField] = "[Add New Item]";
            scope.list.push(addNewItem);
          }
          if (scope.options.allowClear) {
            var addNewItem = {};
            addNewItem[scope.options.searchField] = "[clear]";
            scope.list.unshift(addNewItem);

          }
          if (typeof scope.options.defaultIndex === 'number') {
            if (response[scope.options.defaultIndex]) {
              //scope.selected.items = [response[scope.options.defaultIndex]];
              scope.onSelect(response[scope.options.defaultIndex]);
            }
          }
        });
      };

      var unwatch = scope.$watchCollection('[data, options, modelData]', function(results) {
        if (scope.modelData && scope.modelData && scope.options && scope.options.multiple) {
          if (!scope.property.display.sourceModel) {
            unwatch();
            //No sourceModel so try to populate from modelData for items already selected
            if (scope.modelData[scope.property.display.options.relationship]) {
              scope.selected.items = scope.modelData[scope.property.display.options.relationship];
              assignJunctionMeta();
              scope.list = scope.selected.items; //make sure list contains item otherwise won't be displayed
            }
            return;
          }
          //Lookup multiple records that were previously selected
          var sourceModel = Config.serverParams.models[scope.property.display.sourceModel];
          var referenceModel = Config.serverParams.models[scope.options.model];
          var sourceModelName = sourceModel.plural;
          var referenceModelName = referenceModel.plural;
          var sourceId = scope.modelData[scope.property.display.sourceKey];
          if (!sourceId) {
            return;
          }
          unwatch(); //due to late binding need to unwatch here

          //Pass in junctionMeta as filters if exists
          var params = {};
          if (scope.options.junctionMeta) {
            var keys = Object.keys(scope.options.junctionMeta);
            for (var i in keys) {
              var key = keys[i];
              params['filter[where][' + key + ']'] = scope.options.junctionMeta[key];
            }
          }
          GeneralModelService.getMany(sourceModelName, sourceId, scope.options.relationship, params, {preventCancel: true})
          .then(function(response) {
            if (!response) return;  //in case http request was cancelled
            if (scope.options.api && response.length > 0) {
              //If custom API is provided then use it
              var params = {filter: { where: {}}};
              params.filter.where[scope.options.key] = {inq: []};
              for (var i in response) {
                var item = response[i];
                params.filter.where[scope.options.key].inq.push(item[scope.options.key]);
              }
              apiPath = replaceSessionVariables(scope.options.api);
              GeneralModelService.list(apiPath, params, {preventCancel: true}).then(function(response) {
                if (!response) return;  //in case http request was cancelled
                scope.selected.items = response;
                assignJunctionMeta();
                scope.list = response;
              });
            } else {
              scope.selected.items = response;
              assignJunctionMeta();
              scope.list = response;
            }
          });

        } else if (scope.data && scope.options && scope.options.model) {
          //Lookup default reference record
          var model = Config.serverParams.models[scope.options.model];
          //unwatch(); //due to late binding need to unwatch here
          if (_.isPlainObject(scope.data)) {
            //abort as scope.data is an object (this can occur if manipulating complex objects and utilizing
            //the 'onModelFieldReferenceSelect' emit
            return;
          }
          GeneralModelService.get(model.plural, scope.data)
          .then(function(response) {
            if (!response) return;  //in case http request was cancelled
            //console.log("default select = " + JSON.stringify(response));
            scope.selected.item = response;
            assignJunctionMeta();
            scope.list = [scope.selected.item]; //make sure list contains item otherwise won't be displayed
            if (scope.onModelChanged) scope.onModelChanged({'$item': scope.selected.item});
          }, function(error) {
              if (scope.options.allowInsert) {
                //Not found so just add the item
                var newItem = {};
                newItem[scope.options.key] = scope.data;
                newItem[scope.options.searchField] = scope.data;
                scope.selected.item = newItem;
                assignJunctionMeta();
                scope.list.push(newItem);
              }

          });
        }
     });

     function assignJunctionMeta() {
       if (scope.options.junctionMeta) {
         //Make sure to loop through all items for junctionMeta (previously loaded items will not have junctionMeta populated)
         for (var i in scope.selected.items) {
           var selectedItem = scope.selected.items[i];
           //meta data for junction table in a many-to-many situation
           selectedItem.junctionMeta = scope.options.junctionMeta;
         }
       }
     }

     scope.onSelect = function(item, model) {
       if (scope.options.multiple) {
         if (item && item[scope.options.searchField] == "[Add New Item]") {
           var value = element.find("input.ui-select-search").val();
           item[scope.key] = value;
         }
         //For multi-select add as relationship array objects to modelData (when saving, the CMS relational-upsert.js will handle it)
         //scope.selected.items.push(item); //NOTE: commenting out this line fixes issue with dulpicate entries for Angular v1.6 update
         //Make sure to loop through all items for junctionMeta (previously loaded items will not have junctionMeta populated)
         assignJunctionMeta();

         //Assign to model data
         if (scope.modelData[scope.options.relationship]) {
           //Append to object if already exists; this is needed if more than one reference field for same relationship
           mergeArray(scope.selected.items, scope.modelData[scope.options.relationship]);
         } else {
           scope.modelData[scope.options.relationship] = scope.selected.items;
         }
       } else {
         //For single record reference just assign the ID back to data
         scope.data = item[scope.options.key];
         if (scope.rowData) scope.rowData[scope.options.key] = scope.data; //work around for ui-grid not being able to set ng-model for cell edit
         //emit an event when an item is selected
         scope.$emit('onModelFieldReferenceSelect', scope.modelData, scope.key, item, scope.rowData);
         var textValue = item[scope.options.searchField];
          if (item && item[scope.options.searchField] == "[Add New Item]") {
            //console.log("should add " + $select.search);
            var value = element.find("input.ui-select-search").val();
            scope.data = value;
            var newItem = {};
            newItem[scope.options.key] = value;
            newItem[scope.options.searchField] = value;
            scope.selected.item = newItem;
            scope.list.push(newItem);
          } else if (item && item[scope.options.searchField] == "[clear]") {
            //console.log("should add " + $select.search);
            scope.data = null;
            textValue = "";
          }

          //For the Model List Edit View we need a way to return back the
          //text value to be displayed. The config.json can specify the rowData
          //and textOutputPath to retrieve the data
          if (scope.rowData && scope.textOutputPath && item[scope.options.searchField]) {
            if (scope.textOutputPath.indexOf(".") > -1) {
              var path = scope.textOutputPath.split(".");
              var obj = scope.rowData;
              for (var i = 0; i < path.length-1; i++) {
                var property = path[i];
                if (!obj[property]) obj[property] = {};
                obj = obj[property];
              }
              obj[path[path.length-1]] = textValue;
            } else {
              scope.rowData[scope.textOutputPath] = textValue;
            }
          }

          setTimeout(function() {
            //Needed in a timeout so the scope.data gets saved
            //before emitting ngGridEventEndCellEdit
            scope.$emit('ngGridEventEndCellEdit');

            if (scope.ngBlur) {
              scope.ngBlur({key: scope.key})
            }
          }, 1);
       }
     };

     scope.onRemove = function(item, model) {
       if (scope.options.multiple) {
         //Remove item from array
         var index = scope.selected.items.indexOf(item);
         if (index > -1) {
           scope.selected.items.splice(index, 1);
           assignJunctionMeta();
         }
         if (scope.modelData[scope.options.relationship]) {
           //Remove object if relationship object exists; this is needed if more than one reference field for same relationship
           if (scope.options.key && item[scope.options.key]) {
             //Remove item previously loaded using object key
             var where = {};
             where[scope.options.key] = item[scope.options.key];
             var index = _.findIndex(scope.modelData[scope.options.relationship], where);
             if (index > -1) scope.modelData[scope.options.relationship].splice(index, 1);
           }
           //Look for direct reference match
           var index = scope.modelData[scope.options.relationship].indexOf(item);
           if (index > -1) scope.modelData[scope.options.relationship].splice(index, 1);
           mergeArray(scope.selected.items, scope.modelData[scope.options.relationship]); //make sure to merge in any items previously selected
         } else {
           scope.modelData[scope.options.relationship] = scope.selected.items;
         }
       } else {
         //For single record reference just assign null
         scope.data = null;
       }
     };

     scope.$on('ngGridEventStartCellEdit', function () {
       //When editing focus on the reference button
       element.find("button").trigger("click");
       element.find("input.ui-select-search").focus();
     });


     element.html(getTemplate(scope.options.multiple, scope.options.matchTemplate, scope.options.choiceTemplate)).show();
     $compile(element.contents())(scope);

    }
  };
}])

;

angular.module('dashboard.directives.ModelFieldReferenceSort', [
  "dashboard.Config",
  "dashboard.services.GeneralModel",
  "ui.select"
])

.directive('modelFieldReferenceSortView', ['$compile', function($compile) {
  "ngInject";

  return {
    restrict: 'E',
    template: '<b>{{ options.model }}</b>: {{ data[options.key] }}',
    scope: {
      options: '=options',
      data: '=ngModel',
      required: 'ngRequired',
      disabled: 'ngDisabled'
    },
    link: function(scope, element, attrs) {
    }
  };
}])

.directive('modelFieldReferenceSortEdit', ['$compile', '$cookies', '$timeout', 'Config', 'GeneralModelService', function($compile, $cookies, $timeout, Config, GeneralModelService) {
  "ngInject";

  function getTemplate(key, matchTemplate, choiceTemplate, allowInsert) {
    var repeatExpression = '(index, item) in selectedList';
    if (!allowInsert) repeatExpression += ' track by item.' + key;
    var template = '\
    <ui-select ng-model="selected.item" on-select="onSelect($item, $model)" ng-required="ngRequired" ng-disabled="disabled" > \
    <ui-select-match placeholder="{{ options.placeholder }}">'+ matchTemplate +'</ui-select-match> \
    <ui-select-choices repeat="item in list track by item.'+key+'" refresh="refreshChoices($select.search)" refresh-delay="200">' + choiceTemplate + '</ui-select-choices> \
    </ui-select> \
    <ul ui-sortable="sortableOptions" ng-model="selectedList"> \
      <li ng-repeat="'+repeatExpression+'"> \
        <i class="fa fa-reorder"></i>\
        <div class="title">'+choiceTemplate+'</div> \
        <div class="action"> \
          <a href="" ng-click="removeItem(index)" class="remove" ng-hide="disabled"><i class="fa fa-times"></i></a> \
        </div> \
      </li> \
    </ul>';
    return template;
  }
  return {
    restrict: 'E',
    scope: {
      key: '=key',
      property: '=property',
      options: '=options',
      data: '=ngModel',
      modelData: '=modelData',
      disabled: '=ngDisabled'
    },
    link: function(scope, element, attrs) {

      scope.selected = {};
      scope.selected.item = null; //for single select; initialize to null so placeholder is displayed
      scope.list = []; //data for drop down list
      scope.selectedList = []; //used for tracking whats been selected and also allows for sorting

      scope.sortableOptions = {
        placeholder: 'sortable-placeholder',
        disabled: scope.disabled
      }

      function replaceSessionVariables(string) {
        if (typeof string !== 'string') return string;
        try {
          //Look for session variables in string
          var session = JSON.parse($cookies.get('session')); //needed for eval() below
          var searchString = "{session.";
          var startPos = string.indexOf(searchString);
          while (startPos > -1) {
            var endPos = string.indexOf("}", startPos);
            if (endPos == -1) {
              console.error("ModelList session parsing malformed for string");
              break;
            }
            var sessionKey = string.substring(startPos+1, endPos);
            string = string.slice(0, startPos) + eval(sessionKey) + string.slice(endPos+1);
            startPos = string.indexOf(searchString);
          }
          //Look for model data variable strings
          searchString = "{";
          startPos = string.indexOf(searchString);
          while (startPos > -1) {
            var endPos = string.indexOf("}", startPos);
            if (endPos == -1) {
              console.error("ModelList session parsing malformed for string");
              break;
            }
            var key = string.substring(startPos+1, endPos);
            string = string.slice(0, startPos) + scope.modelData[key] + string.slice(endPos+1);
            startPos = string.indexOf(searchString);
          }
        } catch(e) {
          console.error(e);
        }
        return string;
      }

      scope.refreshChoices = function(search) {
        var model = Config.serverParams.models[scope.options.model];
        var params = { 'filter[limit]': 100 }; //limit only 100 items in drop down list
        params['filter[where]['+scope.options.searchField+'][like]'] = "%" + search + "%";
        if (scope.options.where) {
          //Add additional filtering on reference results
          var keys = Object.keys(scope.options.where);
          for (var i in keys) {
            var key = keys[i];
            params['filter[where][' + key + ']'] = replaceSessionVariables(scope.options.where[key]);
          }
        }
        if (scope.options.filters) {
          var keys = Object.keys(scope.options.filters);
          for (var i in keys) {
            var key = keys[i];
            params[key] = replaceSessionVariables(scope.options.filters[key]);
          }
        }
        var apiPath = model.plural;
        if (scope.options.api) apiPath = replaceSessionVariables(scope.options.api);
        GeneralModelService.list(apiPath, params).then(function(response) {
          if (!response) return; //in case http request was cancelled by newer request
          scope.list = response;
          //Remove items already selected
          for (var i in scope.selectedList) {
            var selectedItem = scope.selectedList[i];
            var filter = {};
            filter[scope.options.key] = selectedItem[scope.options.key];
            var item = _.find(scope.list, filter);
            if (item) {
              scope.list.splice(scope.list.indexOf(item), 1);
            }
          }
          if (scope.options.allowInsert) {
            var addNewItem = {};
            addNewItem[scope.options.searchField] = scope.options.insertText ? scope.options.insertText : "[Add New Item]";
            scope.list.push(addNewItem);
          }

          if (typeof scope.options.defaultIndex === 'number') {
            if (response[scope.options.defaultIndex]) {
              //scope.selected.items = [response[scope.options.defaultIndex]];
              scope.onSelect(response[scope.options.defaultIndex]);
            }
          }
        });
      };

      var unwatch = scope.$watchCollection('[data, options, modelData]', function(results) {
        if (scope.data && scope.options && scope.options.model) {
          unwatch();
          scope.selectedList = scope.data;
        }
      });

      scope.onSelect = function(item, model) {
        scope.$emit('onModelFieldReferenceSortSelect', scope.modelData, scope.key, item);
        if (!item[scope.options.key] && item[scope.options.searchField]) {
          var value = element.find("input.ui-select-search").val();
          item[scope.options.key] = value;
          item[scope.options.searchField] = value;
        }
        var selectedItem = _.find(scope.selectedList, function(i) {
          return i[scope.options.key] === item[scope.options.key] || (i.name && item.name && i.name.toLowerCase() === item.name.toLowerCase());
        });
        if (!selectedItem) {
          scope.selectedList.push(item);
          scope.data = scope.selectedList;
        }
        $timeout(function() {
          delete scope.selected.item;
        });
      };

      scope.removeItem = function(index) {
        var item = scope.selectedList[index];
        scope.selectedList.splice(index, 1);
        scope.list.push(item);
      };


      element.html(getTemplate(scope.options.key, scope.options.matchTemplate, scope.options.choiceTemplate, scope.options.allowInsert)).show();
      $compile(element.contents())(scope);

    }
  };
}])

;

angular.module('dashboard.directives.ModelFieldVideo', [
  "dashboard.services.GeneralModel"
])

.directive('modelFieldVideoView', ['$compile', function($compile) {
  "ngInject";

  return {
    restrict: 'E',
    template: '<b>{{ field.label }}</b>: {{ data[field.name] }}',
    scope: {
      field: '=options',
      data: '=ngModel'
    },
    link: function(scope, element, attrs) {

    }
  };
}])

.directive('modelFieldVideoEdit', ['$sce', '$compile', '$document', 'GeneralModelService', 'SessionService', function($sce, $compile, $document, GeneralModelService, SessionService) {
  "ngInject";

  return {
    restrict: 'E',
    template: '<div class="video-container"><video ng-if="videoUrl" src="{{videoUrl}}" controls></video><div class="placeholder" ng-hide="videoUrl">Upload a Video File</div></div> \
    <div class="button-menu show-menu">\
    <button class="btn btn-default upload-button" ng-hide="disabled">Select File</button> \
    <button class="btn btn-default clear-button" ng-show="imageUrl && !disabled" ng-click="clear()">Clear</button> \
    </div> \
    <div ng-file-drop="onFileSelect($files)" ng-file-drag-over-class="optional-css-class-name-or-function" ng-show="dropSupported && !disabled" class="image-drop">{{ uploadStatus }}</div> \
    <div ng-file-drop-available="dropSupported=true" ng-show="!dropSupported">HTML5 Drop File is not supported!</div> \
    <input type="file" ng-file-select="onFileSelect($files)" ng-hide="disabled"> \
    <button ng-click="upload.abort()" class="cancel-button">Cancel Upload</button>',
    scope: {
      key: "=key",
      options: '=options',
      disabled: '=ngDisabled',
      data: '=ngModel',
      modelData: '=modelData',
      ngChange: '&',
    },
    link: function(scope, element, attrs) {
      var selectedFile = null;

      scope.uploadStatus = "Upload File";

      /**
       * scope.data updates async from controller so need to watch for the first change only
       */
      var unwatch = scope.$watchCollection('data', function(data) {
        if (data) {
          // unwatch(); // Initially for removing the watcher, but with edit reason reintroduced // Remove the watch
          if (typeof data === "string") {
            scope.videoUrl = $sce.trustAsResourceUrl(data);
          } else if (typeof data === "object") {
            if (data.fileUrl) scope.videoUrl = $sce.trustAsResourceUrl(data.fileUrl);
            if (data.videoUrl) scope.videoUrl = $sce.trustAsResourceUrl(data.videoUrl);
          }
        }
      });

      //Use the FileReader to display a preview of the image before uploading
      var fileReader = new FileReader();
      fileReader.onload = function (event) {
        //Set the preview video via scope.videoUrl binding
        scope.videoUrl = $sce.trustAsResourceUrl(event.target.result);
        scope.$apply();
      };
      fileReader.onerror = function(error) {
        console.error(error);
      };

      scope.clear = function() {
        //Clear out an existing selected image
        scope.data = null; //null out the data field
        delete scope.videoUrl; //remove the preview video
        if (scope.ngChange) {
          setTimeout(function() {
            scope.ngChange({key: scope.key})
          }, 1)
        }
      };

      scope.onFileSelect = function($files) {
        // clear the data on a new file select
        if (scope.data) scope.clear();
        //$files: an array of files selected, each file has name, size, and type.
        if ($files.length < 1) return;
        selectedFile = $files[0];
        var s3Path = scope.options.path; //S3 path needed when getting S3 Credentials for validation;
        scope.data = {path: s3Path, file: selectedFile};

        //Load the Preview before uploading
        fileReader.readAsDataURL(selectedFile);
      };

      //Prevent accidental file drop
      $document.on("drop", function(event) {
        if (event.target.nodeName != "INPUT") {
          event.preventDefault();
        }
      });

      $document.on("dragover", function( event ) {
        event.preventDefault();
        //Show Drop Target
        element.find(".image-drop").addClass("show-upload");
        element.find(".input[type=file]").addClass("show-upload");
        element.find(".button-menu").addClass("hide-menu");
      });

      $(window).on("mouseleave", function() {
        //Hide Drop Target
        element.find(".image-drop").removeClass("show-upload");
        element.find(".input[type=file]").removeClass("show-upload");
        element.find(".button-menu").removeClass("hide-menu");
      });

      scope.$on('$destroy', function() {
        //event clean up
        $document.off("drop");
        $document.off("dragover");
        $(window).off("mouseleave");
      });

    }
  };
}])

;

angular.module('dashboard.directives.ModelFieldWYSIWYG', [
  'dashboard.Dashboard.Model.Edit.SaveDialog',
  "dashboard.Config",
  "ui.bootstrap",
  "dashboard.services.GeneralModel",
  "ui.select"
])

.directive('modelFieldWysiwygView', ['$compile', function($compile) {
  "ngInject";

  return {
    restrict: 'E',
    template: '<b>{{ options.model }}</b>: {{ data[options.key] }}',
    scope: {
      options: '=options',
      data: '=ngModel',
      required: 'ngRequired',
      disabled: 'disabled'
    },
    link: function(scope, element, attrs) {
    }
  };
}])

.directive('modelFieldWysiwygEdit', ['$compile', '$cookies', '$timeout', '$uibModal', 'Config', 'FileUploadService', function($compile, $cookies, $timeout, $uibModal, Config, FileUploadService) {
  "ngInject";

  function getTemplate(scope) {
    var fontsList = '';
    if(scope.options && scope.options.fonts) {
      var fonts = scope.options.fonts;
      for (var i = 0; i < fonts.length; i++) {
        fontsList += '<li><a data-edit="fontName ' + fonts[i] + '" style="font-family: \'' + fonts[i] + '\';">' + fonts[i] + '</a></li>';
      }
    }
    var template = '\
      <div class="wysiwyg-toolbar" data-role="editor-toolbar" data-target=".wysiwyg-editor" ng-hide="disabled">\
        <div class="btn-group" ng-show="options && options.fonts">\
          <span class="dropdown">\
          <a class="btn btn-default" title="Font" ng-click="toggleDropdown($event)" ng-disabled="isEditingCode"><i class="fa fa-font"></i>&nbsp;<b class="caret"></b></a>\
          <ul class="menu" ng-click="toggleDropdown($event)">'+fontsList+'</ul></span>\
        </div>\
        <div class="btn-group">\
          <span class="dropdown">\
          <a class="btn btn-default" title="Font Size" ng-click="toggleDropdown($event)" ng-disabled="isEditingCode"><i class="fa fa-text-height"></i>&nbsp;<b class="caret"></b></a>\
          <ul class="menu" ng-click="toggleDropdown($event)" >\
            <li><a data-edit="fontSize 7">24 pt</a></li>\
            <li><a data-edit="fontSize 6">18 pt</a></li>\
            <li><a data-edit="fontSize 5">16 pt</a></li>\
            <li><a data-edit="fontSize 4">14 pt</a></li>\
            <li><a data-edit="fontSize 3">12 pt</a></li>\
            <li><a data-edit="fontSize 2">10 pt</a></li>\
            <li><a data-edit="fontSize 1">7 pt</a></li>\
          </ul></span>\
        </div>\
        <div class="btn-group">\
          <span class="dropdown">\
          <a class="btn btn-default color-picker" title="Font Color" ng-click="toggleDropdown($event)" ng-disabled="isEditingCode"><i class="color-sample"></i>&nbsp;<b class="caret"></b></a>\
          <div class="menu input-append">\
            <input type="color" class="font-color-picker" value="#000" />\
          </div></span>\
        </div>\
        <div class="btn-group">\
          <a class="btn btn-default" data-edit="bold" title="Bold" ng-disabled="isEditingCode"><i class="fa fa-bold"></i></a>\
          <a class="btn btn-default" data-edit="italic" title="Italic" ng-disabled="isEditingCode"><i class="fa fa-italic"></i></a>\
          <a class="btn btn-default" data-edit="underline" title="Underline" ng-disabled="isEditingCode"><i class="fa fa-underline"></i></a>\
        </div>\
        <div class="btn-group">\
          <a class="btn btn-default" data-edit="insertunorderedlist" title="Bullet list" ng-disabled="isEditingCode"><i class="fa fa-list-ul"></i></a>\
          <a class="btn btn-default" data-edit="insertorderedlist" title="Number list" ng-disabled="isEditingCode"><i class="fa fa-list-ol"></i></a>\
          <a class="btn btn-default" data-edit="outdent" title="Reduce indent" ng-disabled="isEditingCode"><i class="fa fa-dedent"></i></a>\
          <a class="btn btn-default" data-edit="indent" title="Indent" ng-disabled="isEditingCode"><i class="fa fa-indent"></i></a>\
        </div>\
        <div class="btn-group">\
          <a class="btn btn-default" data-edit="justifyleft" title="Align Left" ng-disabled="isEditingCode"><i class="fa fa-align-left"></i></a>\
          <a class="btn btn-default" data-edit="justifycenter" title="Center" ng-disabled="isEditingCode"><i class="fa fa-align-center"></i></a>\
          <a class="btn btn-default" data-edit="justifyright" title="Align Right" ng-disabled="isEditingCode"><i class="fa fa-align-right"></i></a>\
          <a class="btn btn-default" data-edit="justifyfull" title="Justify" ng-disabled="isEditingCode"><i class="fa fa-align-justify"></i></a>\
        </div>\
        <div class="btn-group">\
          <span class="dropdown">\
          <a class="btn btn-default" data-original-title="Hyperlink" ng-click="toggleDropdown($event)" ng-disabled="isEditingCode"><i class="fa fa-link"></i></a>\
          <div class="menu">\
            <input class="form-control" placeholder="URL" type="text" data-edit="createLink">\
            <button class="btn btn-default add-button" type="button">Add</button>\
          </div></span>\
        </div>\
        <div class="btn-group picture-button">\
          <a class="btn btn-default picture-tool" title="Insert picture (or just drag & drop)" ng-disabled="!options.allowImageUpload || isEditingCode"><i class="fa fa-picture-o"></i></a>\
          <input type="file" class="wysiwyg-picture-input" data-role="magic-overlay" data-target=".wysiwyg-toolbar .picture-tool" ng-file-select="onFileSelect($files)"  ng-disabled="!options.allowImageUpload || isEditingCode" />\
        </div>\
        <div class="btn-group">\
          <a class="btn btn-default" data-edit="undo" title="Undo" ng-disabled="isEditingCode"><i class="fa fa-undo"></i></a>\
          <a class="btn btn-default" data-edit="redo" title="Redo" ng-disabled="isEditingCode"><i class="fa fa-repeat"></i></a>\
        </div>\
        <div class="btn-group">\
          <a class="btn btn-default" title="Edit HTML" ng-click="toggleCodeEdit()"><i class="fa fa-code"></i></a>\
        </div>\
      </div>\
      <div class="wysiwyg-editor" ng-hide="isEditingCode"></div>\
      <div class="code-editor" ng-show="isEditingCode"></div>\
    ';
    return template;
  }
  return {
    restrict: 'E',
    require: "ngModel",
    scope: {
      key: '=key',
      property: '=property',
      options: '=options',
      data: '=ngModel',
      modelData: '=modelData',
      disabled: '=ngDisabled'
    },
    link: function(scope, element, attrs, ngModel) {
      var $wysiwyg, codeEditor;

      function init() {
        scope.isEditingCode = false;
        scope.toggleDropdown = toggleDropdown;
        scope.onFileSelect = onFileSelect;
        scope.toggleCodeEdit = toggleCodeEdit;

        element.html(getTemplate(scope)).show();
        $compile(element.contents())(scope);

        initWysiwygEditor();
        initColorPicker();

        codeEditor = ace.edit(element.find('.code-editor')[0]);
        codeEditor.getSession().setMode("ace/mode/html");

        $(element).find('.wysiwyg-toolbar [data-role=magic-overlay]').each(function () {
          var overlay = $(this), target = $(overlay.data('target'));
          overlay.css({opacity: 0, position: 'absolute', width: "40px", height: "34px", top: "0", left: "0" });
        });

        ngModel.$render = function() {
          $wysiwyg.html(ngModel.$viewValue || "");
        };

        $wysiwyg.bind("blur keyup change", function() {
          scope.$apply(function() {
            ngModel.$setViewValue($wysiwyg.html());
          });
        });

        codeEditor.on("blur", function() {
          ngModel.$setViewValue(codeEditor.getValue());
          $wysiwyg.html(ngModel.$viewValue);
        });
      }

      function initWysiwygEditor() {
        // check for multiple instances
        var instances = $('.wysiwyg-editor');
        var instanceIdx = 0
        if(instances && instances.length > 0) {
          instanceIdx = instances.length;
        }
        $wysiwyg = angular.element(element).find('.wysiwyg-editor');
        var editorId = 'wysiwyg-editor-'+instanceIdx;
        var toolbarId = 'editor'+instanceIdx+'-toolbar';
        $wysiwyg.attr('id', editorId);
        var $toolbar = angular.element(element).find('.wysiwyg-toolbar');
        $toolbar.attr('data-role', toolbarId);
        $toolbar.attr('data-target', '#'+editorId);

        if (!scope.disabled) $wysiwyg.wysiwyg({
          toolbarSelector: '[data-role='+toolbarId+']',
          hotKeys: {},
          dragAndDropImages: false
        });
      }

      function initColorPicker() {
        var $colorPicker = angular.element(element).find(".font-color-picker");
        if($colorPicker) {
          $colorPicker.spectrum({
            flat: true,
            cancelText: "",
            clickoutFiresChange: false,
            preferredFormat: "rgb",
            showInput: true,
            change: function(color) {
              $(this).closest('.dropdown').find('.color-sample').css({backgroundColor: color.toHexString()});
              $wysiwyg.focus();
              document.execCommand("foreColor", 0,  color.toHexString());
              $(this).parent('.menu').removeClass('open');
            }
          });
        }
      }

      function toggleDropdown(event) {
        var $element = $(event.currentTarget).parent().find('.menu');
        if ($element.hasClass('open')) {
          $element.removeClass('open');
        } else {
          $element.addClass('open');
        }
      }

      function onFileSelect($files) {
        if (!scope.options.allowImageUpload || $files.length == 0) return;
        scope.status = "Uploading Image";
        scope.progress = 0.0;
        var modalInstance = $uibModal.open({
          templateUrl: 'app/dashboard/model/edit/ModelEditSaveDialog.html',
          controller: 'ModelEditSaveDialogCtrl',
          scope: scope
        });
        FileUploadService.uploadFile($files[0], scope.options.imagePath)
          .then(function(result) {
            scope.status = "Upload Complete";
            document.execCommand('insertimage', 0, result.fileUrl);
            modalInstance.close();
          }, function(error) {
            console.error(error);
            scope.status = "There was an error uploading the image. Please contact an Administrator.";
          }, function(progress) {
            scope.progress = progress;
          });
      }

      function toggleCodeEdit() {
        scope.isEditingCode = !scope.isEditingCode;
        if (scope.isEditingCode) {
          var htmlCode = $wysiwyg[0].innerHTML;
          htmlCode = html_beautify(htmlCode, {indent_size: 2});
          ngModel.$setViewValue(htmlCode);
          codeEditor.setValue(htmlCode);
        } else {
          ngModel.$setViewValue(codeEditor.getValue());
          $wysiwyg.html(ngModel.$viewValue);
        }
      }

      init();
    }
  };
}])

;

angular.module('dashboard.filters', [
])

/**
 * Display a decimal value with the supplied decimal scale (number to the right of the decimal)
 */
.filter('decimalWithScale', function() {
"ngInject";

  return function(number, scale) {
    if (typeof number === 'undefined' || number === '') return '';
    value = number + ''; //force into a string
    var indexOfDecimal = value.indexOf('.');
    if (indexOfDecimal === -1) value += '.0'; //no decimal so add it
    else if (indexOfDecimal === 1 && value.charAt(0) === '-') {
      value = value.slice(0, 1) + '0' + value.slice(1);
    } //if no leading zero and negative sign in front
    else if (indexOfDecimal === 0) value = '0' + value; //no leading zero
    var valueComponents = value.split('.');
    if (valueComponents.length > 1) {
      if (!valueComponents[0] || valueComponents[0].length === 0) valueComponents[0] = 0;
      if (isNaN(parseInt(valueComponents[0]))) return NaN;
      if (indexOfDecimal === 1 && value.charAt(0) === '-') {
        value = '-' + parseInt(valueComponents[0]) + '.';
      } else {
        value = parseInt(valueComponents[0]) + '.';
      }
      if (valueComponents[1].match(/[\D]/) !== null) {
        return NaN
      } else if (valueComponents[1].length > scale) {
        //Truncate value
        value += valueComponents[1].substring(0, scale);
      } else {
        value += valueComponents[1];
      }
      if (valueComponents[1].length < scale) {
        //Pad with zeros
        for (var i = 0; i < scale - valueComponents[1].length; i++) {
          value += '0';
        }
      }
    }
    return value;
  };
})
;
angular.module('dashboard.filters.locale', [
])

/**
 * Maps ISO 639-2 (3 letter language code) to ISO 639-1 (2 letter language code)
 */
.filter('iso-639-1', function() {
  "ngInject";

  var localeMap = {
    "aar": "aa",
    "abk": "ab",
    "afr": "af",
    "aka": "ak",
    "alb": "sq",
    "amh": "am",
    "ara": "ar",
    "arg": "an",
    "arm": "hy",
    "asm": "as",
    "ava": "av",
    "ave": "ae",
    "aym": "ay",
    "aze": "az",
    "bak": "ba",
    "bam": "bm",
    "baq": "eu",
    "bel": "be",
    "ben": "bn",
    "bih": "bh",
    "bis": "bi",
    "bod": "bo",
    "bos": "bs",
    "bre": "br",
    "bul": "bg",
    "bur": "my",
    "cat": "ca",
    "ces": "cs",
    "cha": "ch",
    "che": "ce",
    "chi": "zh",
    "chu": "cu",
    "chv": "cv",
    "cor": "kw",
    "cos": "co",
    "cre": "cr",
    "cym": "cy",
    "cze": "cs",
    "dan": "da",
    "deu": "de",
    "div": "dv",
    "dut": "nl",
    "dzo": "dz",
    "ell": "el",
    "eng": "en",
    "epo": "eo",
    "est": "et",
    "eus": "eu",
    "ewe": "ee",
    "fao": "fo",
    "fas": "fa",
    "fij": "fj",
    "fin": "fi",
    "fra": "fr",
    "fre": "fr",
    "fry": "fy",
    "ful": "ff",
    "geo": "ka",
    "ger": "de",
    "gla": "gd",
    "gle": "ga",
    "glg": "gl",
    "glv": "gv",
    "gre": "el",
    "grn": "gn",
    "guj": "gu",
    "hat": "ht",
    "hau": "ha",
    "heb": "he",
    "her": "hz",
    "hin": "hi",
    "hmo": "ho",
    "hrv": "hr",
    "hun": "hu",
    "hye": "hy",
    "ibo": "ig",
    "ice": "is",
    "ido": "io",
    "iii": "ii",
    "iku": "iu",
    "ile": "ie",
    "ina": "ia",
    "ind": "id",
    "ipk": "ik",
    "isl": "is",
    "ita": "it",
    "jav": "jv",
    "jpn": "ja",
    "kal": "kl",
    "kan": "kn",
    "kas": "ks",
    "kat": "ka",
    "kau": "kr",
    "kaz": "kk",
    "khm": "km",
    "kik": "ki",
    "kin": "rw",
    "kir": "ky",
    "kom": "kv",
    "kon": "kg",
    "kor": "ko",
    "kua": "kj",
    "kur": "ku",
    "lao": "lo",
    "lat": "la",
    "lav": "lv",
    "lim": "li",
    "lin": "ln",
    "lit": "lt",
    "ltz": "lb",
    "lub": "lu",
    "lug": "lg",
    "mac": "mk",
    "mah": "mh",
    "mal": "ml",
    "mao": "mi",
    "mar": "mr",
    "may": "ms",
    "mkd": "mk",
    "mlg": "mg",
    "mlt": "mt",
    "mon": "mn",
    "mri": "mi",
    "msa": "ms",
    "mya": "my",
    "nau": "na",
    "nav": "nv",
    "nbl": "nr",
    "nde": "nd",
    "ndo": "ng",
    "nep": "ne",
    "nld": "nl",
    "nno": "nn",
    "nob": "nb",
    "nor": "no",
    "nya": "ny",
    "oci": "oc",
    "oji": "oj",
    "ori": "or",
    "orm": "om",
    "oss": "os",
    "pan": "pa",
    "per": "fa",
    "pli": "pi",
    "pol": "pl",
    "por": "pt",
    "pus": "ps",
    "que": "qu",
    "roh": "rm",
    "ron": "ro",
    "rum": "ro",
    "run": "rn",
    "rus": "ru",
    "sag": "sg",
    "san": "sa",
    "sin": "si",
    "slk": "sk",
    "slo": "sk",
    "slv": "sl",
    "sme": "se",
    "smo": "sm",
    "sna": "sn",
    "snd": "sd",
    "som": "so",
    "sot": "st",
    "spa": "es",
    "sqi": "sq",
    "srd": "sc",
    "srp": "sr",
    "ssw": "ss",
    "sun": "su",
    "swa": "sw",
    "swe": "sv",
    "tah": "ty",
    "tam": "ta",
    "tat": "tt",
    "tel": "te",
    "tgk": "tg",
    "tgl": "tl",
    "tha": "th",
    "tib": "bo",
    "tir": "ti",
    "ton": "to",
    "tsn": "tn",
    "tso": "ts",
    "tuk": "tk",
    "tur": "tr",
    "twi": "tw",
    "uig": "ug",
    "ukr": "uk",
    "urd": "ur",
    "uzb": "uz",
    "ven": "ve",
    "vie": "vi",
    "vol": "vo",
    "wel": "cy",
    "wln": "wa",
    "wol": "wo",
    "xho": "xh",
    "yid": "yi",
    "yor": "yo",
    "zha": "za",
    "zho": "zh",
    "zul": "zu"
  };

  return function(languageCode) {
    if (!languageCode) languageCode = 'eng';
    return localeMap[languageCode.toLowerCase()];
  };
})
;
angular.module('dashboard.services.Cache', [
  'dashboard.Config',
  'dashboard.Utils',
  'ngCookies'
])

.service('CacheService', function() {
  "ngInject";

  this.KEY_DELIMITER = '-';

  this.get = function(key) {
    if(!localStorage.getItem(key)) return null;
    try {
        var cached = JSON.parse(localStorage.getItem(key));
        return cached;
    }
    catch (e) {
        return null;
    }
  };

  this.set = function(key,value) {
    try{
        localStorage.setItem(key,JSON.stringify(value));
    } catch(e) {
        this.remove(key);
    }
  };

  this.remove = function(key) {
    localStorage.removeItem(key);
  };

  this.getKeyForAction = function(action,params) {
    var key = action.options.model + this.KEY_DELIMITER + action.route;
    if (action.options.api) key = action.options.api;
    if(params) key += this.KEY_DELIMITER + JSON.stringify(params);
    return key;
  }

  this.clear = function(model) {
    var key = model;
    var regex = new RegExp('^'+key)
    for(var k in localStorage)
    {
        if(regex.test(k))
        {
            this.remove(k);
        }
    }
  };

  this.reset = function()
  {
    localStorage.clear();
  }
})

;

angular.module('dashboard.services.Dashboard', [
  'dashboard.Config',
  'dashboard.Utils'
])

.service('DashboardService', ['$cookies', 'Config', function($cookies, Config) {
  "ngInject";

  var self = this;
  var _roles = [];
  var _nav = [];

  /**
   * Filters the Config.serverParams.nav for accessible navigation sections based on the users role
   */
  this.getNavigation = function() {
    var roles = angular.fromJson($cookies.get('roles'));
    if(_.isEmpty(_nav) || !_.isEqual(_roles, roles)) {
      //make a copy of the nav as not to modify the original object
      _roles = roles;
      var nav = angular.copy(Config.serverParams.nav);
      _nav = self.restrictMenuItems(nav);
    }
    return _nav;
  };

  /**
   * Get the default navigation parameters based on the users role
   * @param navList
   * @param defaultNav
   * @returns {*}
   */
  this.getDefaultNav = function(navList, defaultNav) {
    if (defaultNav.state) {
      return defaultNav;
    } else if (defaultNav.params && !defaultNav.params.action) {
      //defaultNav.params.action not specified so find defaultSubNav
      var nav = _.find(navList, {path: defaultNav.params.model});
      if (nav) {
        if (nav.hidden) {
          //default navigation is hidden so find one that is not hidden
          for (var i = 0; i < navList.length; i++) {
            nav = navList[i];
            defaultNav = { params: { model: nav.path}};
            if (!nav.hidden) break;
          }
          if (nav.hidden) return null; //do not load any navigation items if no nav is visible
        }
        var subnav = nav.subnav[nav.defaultSubNavIndex];
        if (subnav) {
          if (!defaultNav.params) defaultNav.params = {};
          defaultNav.params.action = subnav.label;
          defaultNav.route = subnav.route;
        } else {
          console.error('No defaultSubNavIndex defined in nav', nav);
        }
      }
    }
    return defaultNav;
  };

  /*
   * Only return menu items that the current user has access to
   */
  this.restrictMenuItems = function(menus) {
    for (var idx in menus) {
      var menu = menus[idx];

      if (self.hasAccess(_roles, menu)) {
        if (menu.hasOwnProperty('subnav') &&
          menu.subnav.length > 0) {
          var subItems = this.restrictMenuItems(menu.subnav);
          if (subItems) {
            menu.subnav = subItems;
            //check if defaultSubNavIndex is hidden and if so find one to display
            if (menu.defaultSubNavIndex !== null && menu.defaultSubNavIndex !== undefined) {
              if (menu.subnav[menu.defaultSubNavIndex] && menu.subnav[menu.defaultSubNavIndex].hidden) {
                //Find item the user does have access
                for (var subNavIndex in menu.subnav) {
                  var subnav = menu.subnav[subNavIndex];
                  if (self.hasAccess(_roles, subnav) && !subnav.hidden) {
                    menu.defaultSubNavIndex = parseInt(subNavIndex);
                    break;
                  }
                }
              }
            }
          }
        }
      } else {
        //user does not have access
        menu.hidden = true;
      }
    }
    return menus;
  };

  /*
   * Check if any of the given roles has access to the menu item
   */
  this.hasAccess = function(roles, menu) {
    // if menu item has no roles property, menu item is unrestricted
    if (!menu.hasOwnProperty('roles') ||
      !(menu.roles instanceof Array))
      return true;

    for (var idx in roles) {
      if (menu.roles.indexOf(roles[idx].name) > -1)
        return true;
    }

    // made it here, user has no access
    return false;
  };

}]);

angular.module('dashboard.services.FileUpload', [
  'dashboard.Config',
  'dashboard.Utils',
  'ngCookies',
  "angularFileUpload"
])

.service('FileUploadService', ['$cookies', '$q', '$upload', 'Config', 'Utils', function($cookies, $q, $upload, Config, Utils) {
  "ngInject";

  var self = this;

  this.getS3Credentials = function(path, fileType, isRegistrySurvey) {
    var params = {
        access_token: $cookies.get('accessToken'),
        path: path,
        fileType: fileType,
        r: new Date().getTime(), //IE caches results so passing timestamp helps with cache prevention
        isRegistrySurvey: isRegistrySurvey
    };
    return Utils.apiHelper('GET', Config.serverParams.cmsBaseUrl + '/aws/s3/credentials', params);
  };

  this.getFileUploadData = function(credentials) {
    return {
      key: credentials.uniqueFilePath, // the key to store the file on S3, could be file name or customized
      AWSAccessKeyId: credentials.AWSAccessKeyId, 
      acl: "private", // sets the access to the uploaded file in the bucker: private or public 
      policy: credentials.policy, // base64-encoded json policy (see article below)
      signature: credentials.signature, // base64-encoded signature based on policy string (see article below)
      //"Content-Type": file.type != '' ? file.type : 'application/octet-stream', // content type of the file (NotEmpty),
      success_action_status: "201",
      "Cache-Control": "max-age=31536000"
      //filename:  credentials.uniqueFilePath // this is needed for Flash polyfill IE8-9
    };
  };

  this.uploadFile = function(file, path) {

    var isRegistrySurvey = false;

    // parse the object into variables if registry survey is coming in
    if (file.isRegistrySurvey) {
      var isRegistrySurvey = true;
      file = file.file;
    }

    if (typeof file === 'string' || file instanceof String && file.indexOf('data:') == 0) {
      //Found data URI so convert to blob
      file = self.dataURItoBlob(file);
    }

    var fileType = '';
    if (file.type) {
      fileType = file.type;
    } else if (file.name) {
      fileType = self.detectMimeTypeByExt(file.name);
    }

    //Get S3 credentials from Server
    var deferred = $q.defer();
    self.getS3Credentials(path, fileType ? fileType : "", isRegistrySurvey).then(function(credentials) {
      $upload.upload({
        url: credentials.uploadUrl, //S3 upload url including bucket name,
        method: 'POST',
        data : self.getFileUploadData(credentials),
        file: file
      }).progress(function(event) {
        //progress
        var progress = (event.position) / file.size;
        deferred.notify(progress);
      }).success(function(data) {
        //success
        var locationUrl;
        var xmldoc = new DOMParser().parseFromString(data, 'text/xml');

        try {
          var locationPath = xmldoc.evaluate('/PostResponse/Location', xmldoc, null, XPathResult.STRING_TYPE, null);
          locationUrl = locationPath.stringValue;
        } catch(e) { // IE
          var list = xmldoc.documentElement.childNodes;
          for (var i=0; i<list.length; i++) {
            var node = list[i];
            if (node.nodeName == 'Location') {
              locationUrl = node.firstChild.nodeValue;
              break;
            }
          }
        }

        deferred.resolve({
          filename: file.name,
          size: file.size,
          fileUrl: locationUrl
        });
      }).error(function(error) {
        //error
        console.log(error);
        deferred.reject(error);
      }); 
    }, function(error) {
      console.log(error);
      deferred.reject(error);
    });   
    
    return deferred.promise;    
  };

  
  var uploadFilePath = null;
  this.uploadImages = function(imageFiles) {
    //Try to get index, results, and deferred objects from recursion
    //otherwise init the variables 
    var fileIndex = arguments[1];
    var exportIndex = arguments[2];
    var imageUploadResults = arguments[3];
    var deferred = arguments[4];
    if (!fileIndex) fileIndex = 0;
    if (!exportIndex) exportIndex = 0;
    if (!deferred) deferred = $q.defer();
    var fileKey = null; //the file key represents the model (table) column key used for reference 
    var exportKey = null; //the export key represents the various sizes of the image
    var file = null;
    var currentUploadedSize = 0;
    var totalUploadSize = 0;
    
    //Get next file to process
    if (imageFiles && imageFiles instanceof Array && fileIndex < imageFiles.length) {
      //Array of File

      fileIndex++;
      exportIndex = 0;
      if (exportKey == 1) {
        //Array of files have no exportKeys so recurse to next file
        self.uploadImages(imageFiles, fileIndex, exportIndex, imageUploadResults, deferred);
        return;
      }
      
      if (imageFiles[fileIndex] && imageFiles[fileIndex].file) {
        uploadFilePath = imageFiles[fileIndex].path;
        file = imageFiles[fileIndex].file;
      } else {
        file = imageFiles[fileIndex];
      }
      if (!imageUploadResults) imageUploadResults = []; //initialize results object
      //Calculate File Size
      for (var i = 0; i < imageFiles.length; i++) {
        var imageFile = imageFiles[i].file ? imageFiles[i].file : imageFiles[i];
        if (i < fileIndex) currentUploadedSize += imageFile.size;
        totalUploadSize += imageFile.size;
      }
    } else if (typeof imageFiles === 'object' && !imageFiles.file && fileIndex < Object.keys(imageFiles).length) {
      //Object containing key/value pairs for various key sizes
      var fileKeys = Object.keys(imageFiles);
      fileKey = fileKeys[fileIndex];
      var exports = imageFiles[fileKey].file ? imageFiles[fileKey].file : imageFiles[fileKey];
      if (imageFiles[fileKey].path) uploadFilePath = imageFiles[fileKey].path;
      if (exports && exports.type && exports.size) {
        //exports is a file object
        if (exportIndex > 0) {
          //Processed all export keys so move to next file
          fileIndex++;
          exportIndex = 0;
          self.uploadImages(imageFiles, fileIndex, exportIndex, imageUploadResults, deferred);
          return;
        }
        file = exports; //the case where no exports are specified in options
      } else {
        //exports contains various export file objects
        var exportKeys = Object.keys(exports);
        if (exportIndex >= exportKeys.length) {
          //Processed all export keys so move to next file
          fileIndex++;
          exportIndex = 0;
          self.uploadImages(imageFiles, fileIndex, exportIndex, imageUploadResults, deferred);
          return;
        }
        exportKey = exportKeys[exportIndex];
        if (exports[exportKey] && exports[exportKey].file) {
          uploadFilePath = exports[exportKey].path;
          file = exports[exportKey].file;
        } else {
          file = exports[exportKey];
        }
      }
      
      
      if (!imageUploadResults) imageUploadResults = {}; //initialize results object
      //Calculate File Size
      for (var i = 0; i < fileKeys.length; i++) {
        var fkey = fileKeys[i];
        var exports = imageFiles[fkey];
        if (exports && exports.type && exports.size) {
          //exports is a file object
          var imageFile = exports;
          if (i < fileIndex) {
            currentUploadedSize += imageFile.size;
          }
          totalUploadSize += imageFile.size;
        } else if (exports && exports.file) {
          var imageFile = exports.file;
          if (i < fileIndex) {
            currentUploadedSize += imageFile.size;
          }
          totalUploadSize += imageFile.size;
        } else {
          //exports contains various export file objects
          for (var k = 0; k < exportKeys.length; k++) {
            var ekey = exportKeys[k];
            var imageFile = exports[ekey].file ? exports[ekey].file : exports[ekey];
            if (i < fileIndex || (i == fileIndex && k < exportIndex)) {
              currentUploadedSize += imageFile.size;
            }
            totalUploadSize += imageFile.size;
          }
        }
      }
    }

    if (!file) {
      //No more files to upload
      deferred.resolve(imageUploadResults);
      return deferred.promise;
    }

    //Get S3 credentials from Server
    self.getS3Credentials(uploadFilePath, file.type, false).then(function(credentials) {
      $upload.upload({
        url: credentials.uploadUrl, //S3 upload url including bucket name,
        method: 'POST',
        data : self.getFileUploadData(credentials),
        file: file
      }).progress(function(event) {
        //progress
        var progress = (currentUploadedSize + event.position) / totalUploadSize;//event.total;
        deferred.notify(progress);
      }).success(function(data) {
        //success
        var locationUrl;
        var xmldoc = new DOMParser().parseFromString(data, 'text/xml');

        try {
          var locationPath = xmldoc.evaluate('/PostResponse/Location', xmldoc, null, XPathResult.STRING_TYPE, null);
          locationUrl = locationPath.stringValue;
        } catch(e) { // IE
          var list = xmldoc.documentElement.childNodes;
          for (var i=0; i<list.length; i++) {
            var node = list[i];
            if (node.nodeName == 'Location') {
              locationUrl = node.firstChild.nodeValue;
              break;
            }
          }
        }

        if (fileKey) {
          if (exportKey) {
            if (!imageUploadResults[fileKey]) imageUploadResults[fileKey] = {};
            imageUploadResults[fileKey][exportKey] = locationUrl; //results store in key/value pair
          } else {
            //no exportKey so directly assign to imageUploadResults
            imageUploadResults[fileKey] = locationUrl;
          }
        } else {
          imageUploadResults.push(locationUrl); //results store in array
        }
        
        //recurse through all imageFiles
        exportIndex++;
        self.uploadImages(imageFiles, fileIndex, exportIndex, imageUploadResults, deferred); 
      }).error(function(error) {
        //error
        console.log(error);
        deferred.reject(error);
      }); 
    }, function(error) {
      //get credentials error
      console.log(error);
      deferred.reject(error);
      
    });   
    
    return deferred.promise;
  };

  this.dataURItoBlob = function(dataURI) {
    // convert base64/URLEncoded data component to raw binary data held in a string
    var byteString;
    if (dataURI.split(',')[0].indexOf('base64') >= 0)
      byteString = atob(dataURI.split(',')[1]);
    else
      byteString = unescape(dataURI.split(',')[1]);

    // separate out the mime component
    var mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];

    // write the bytes of the string to a typed array
    var ia = new Uint8Array(byteString.length);
    for (var i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }

    return new Blob([ia], {type:mimeString});
  };

  this.detectMimeTypeByExt = function (filename) {
    if (filename.length > 0) {
      var ext = filename.split('.').pop();
      if (ext.length > 0) {
        var mimes = {
          '3dm': 'x-world/x-3dmf',
          '3dmf': 'x-world/x-3dmf',
          'a': 'application/octet-stream',
          'aab': 'application/x-authorware-bin',
          'aam': 'application/x-authorware-map',
          'aas': 'application/x-authorware-seg',
          'abc': 'text/vnd.abc',
          'acgi': 'text/html',
          'afl': 'video/animaflex',
          'ai': 'application/postscript',
          'aif': 'audio/aiff',
          'aifc': 'audio/aiff',
          'aiff': 'audio/aiff',
          'aim': 'application/x-aim',
          'aip': 'text/x-audiosoft-intra',
          'ani': 'application/x-navi-animation',
          'aos': 'application/x-nokia-9000-communicator-add-on-software',
          'aps': 'application/mime',
          'arc': 'application/octet-stream',
          'arj': 'application/arj',
          'art': 'image/x-jg',
          'asf': 'video/x-ms-asf',
          'asm': 'text/x-asm',
          'asp': 'text/asp',
          'asx': 'application/x-mplayer2',
          'au': 'audio/basic',
          'avi': 'application/x-troff-msvideo',
          'avs': 'video/avs-video',
          'bcpio': 'application/x-bcpio',
          'bin': 'application/mac-binary',
          'bm': 'image/bmp',
          'bmp': 'image/bmp',
          'boo': 'application/book',
          'book': 'application/book',
          'boz': 'application/x-bzip2',
          'bsh': 'application/x-bsh',
          'bz': 'application/x-bzip',
          'bz2': 'application/x-bzip2',
          'c': 'text/plain',
          'c++': 'text/plain',
          'cat': 'application/vnd.ms-pki.seccat',
          'cc': 'text/plain',
          'ccad': 'application/clariscad',
          'cco': 'application/x-cocoa',
          'cdf': 'application/cdf',
          'cer': 'application/pkix-cert',
          'cha': 'application/x-chat',
          'chat': 'application/x-chat',
          'class': 'application/java',
          'com': 'application/octet-stream',
          'conf': 'text/plain',
          'cpio': 'application/x-cpio',
          'cpp': 'text/x-c',
          'cpt': 'application/mac-compactpro',
          'crl': 'application/pkcs-crl',
          'crt': 'application/pkix-cert',
          'csh': 'application/x-csh',
          'css': 'application/x-pointplus',
          'cxx': 'text/plain',
          'dcr': 'application/x-director',
          'deepv': 'application/x-deepv',
          'def': 'text/plain',
          'der': 'application/x-x509-ca-cert',
          'dif': 'video/x-dv',
          'dir': 'application/x-director',
          'dl': 'video/dl',
          'doc': 'application/msword',
          'dot': 'application/msword',
          'dp': 'application/commonground',
          'drw': 'application/drafting',
          'dump': 'application/octet-stream',
          'dv': 'video/x-dv',
          'dvi': 'application/x-dvi',
          'dwf': 'drawing/x-dwf (old)',
          'dwg': 'application/acad',
          'dxf': 'application/dxf',
          'dxr': 'application/x-director',
          'el': 'text/x-script.elisp',
          'elc': 'application/x-bytecode.elisp (compiled elisp)',
          'env': 'application/x-envoy',
          'eps': 'application/postscript',
          'es': 'application/x-esrehber',
          'etx': 'text/x-setext',
          'evy': 'application/envoy',
          'exe': 'application/octet-stream',
          'f': 'text/plain',
          'f77': 'text/x-fortran',
          'f90': 'text/plain',
          'fdf': 'application/vnd.fdf',
          'fif': 'application/fractals',
          'fli': 'video/fli',
          'flo': 'image/florian',
          'flx': 'text/vnd.fmi.flexstor',
          'fmf': 'video/x-atomic3d-feature',
          'for': 'text/plain',
          'fpx': 'image/vnd.fpx',
          'frl': 'application/freeloader',
          'funk': 'audio/make',
          'g': 'text/plain',
          'g3': 'image/g3fax',
          'gif': 'image/gif',
          'gl': 'video/gl',
          'gsd': 'audio/x-gsm',
          'gsm': 'audio/x-gsm',
          'gsp': 'application/x-gsp',
          'gss': 'application/x-gss',
          'gtar': 'application/x-gtar',
          'gz': 'application/x-compressed',
          'gzip': 'application/x-gzip',
          'h': 'text/plain',
          'hdf': 'application/x-hdf',
          'help': 'application/x-helpfile',
          'hgl': 'application/vnd.hp-hpgl',
          'hh': 'text/plain',
          'hlb': 'text/x-script',
          'hlp': 'application/hlp',
          'hpg': 'application/vnd.hp-hpgl',
          'hpgl': 'application/vnd.hp-hpgl',
          'hqx': 'application/binhex',
          'hta': 'application/hta',
          'htc': 'text/x-component',
          'htm': 'text/html',
          'html': 'text/html',
          'htmls': 'text/html',
          'htt': 'text/webviewhtml',
          'htx': 'text/html',
          'ice': 'x-conference/x-cooltalk',
          'ico': 'image/x-icon',
          'idc': 'text/plain',
          'ief': 'image/ief',
          'iefs': 'image/ief',
          'iges': 'application/iges',
          'igs': 'application/iges',
          'ima': 'application/x-ima',
          'imap': 'application/x-httpd-imap',
          'inf': 'application/inf',
          'ins': 'application/x-internett-signup',
          'ip': 'application/x-ip2',
          'isu': 'video/x-isvideo',
          'it': 'audio/it',
          'iv': 'application/x-inventor',
          'ivr': 'i-world/i-vrml',
          'ivy': 'application/x-livescreen',
          'jam': 'audio/x-jam',
          'jav': 'text/plain',
          'java': 'text/plain',
          'jcm': 'application/x-java-commerce',
          'jfif': 'image/jpeg',
          'jfif-tbnl': 'image/jpeg',
          'jpe': 'image/jpeg',
          'jpeg': 'image/jpeg',
          'jpg': 'image/jpeg',
          'jps': 'image/x-jps',
          'js': 'application/x-javascript',
          'jut': 'image/jutvision',
          'kar': 'audio/midi',
          'ksh': 'application/x-ksh',
          'la': 'audio/nspaudio',
          'lam': 'audio/x-liveaudio',
          'latex': 'application/x-latex',
          'lha': 'application/lha',
          'lhx': 'application/octet-stream',
          'list': 'text/plain',
          'lma': 'audio/nspaudio',
          'log': 'text/plain',
          'lsp': 'application/x-lisp',
          'lst': 'text/plain',
          'lsx': 'text/x-la-asf',
          'ltx': 'application/x-latex',
          'lzh': 'application/octet-stream',
          'lzx': 'application/lzx',
          'm': 'text/plain',
          'm1v': 'video/mpeg',
          'm2a': 'audio/mpeg',
          'm2v': 'video/mpeg',
          'm3u': 'audio/x-mpequrl',
          'man': 'application/x-troff-man',
          'map': 'application/x-navimap',
          'mar': 'text/plain',
          'mbd': 'application/mbedlet',
          'mc$': 'application/x-magic-cap-package-1.0',
          'mcd': 'application/mcad',
          'mcf': 'image/vasa',
          'mcp': 'application/netmc',
          'me': 'application/x-troff-me',
          'mht': 'message/rfc822',
          'mhtml': 'message/rfc822',
          'mid': 'application/x-midi',
          'midi': 'application/x-midi',
          'mif': 'application/x-frame',
          'mime': 'message/rfc822',
          'mjf': 'audio/x-vnd.audioexplosion.mjuicemediafile',
          'mjpg': 'video/x-motion-jpeg',
          'mm': 'application/base64',
          'mme': 'application/base64',
          'mod': 'audio/mod',
          'moov': 'video/quicktime',
          'mov': 'video/quicktime',
          'movie': 'video/x-sgi-movie',
          'mp2': 'audio/mpeg',
          'mp3': 'audio/mpeg3',
          'mpa': 'audio/mpeg',
          'mpc': 'application/x-project',
          'mpe': 'video/mpeg',
          'mpeg': 'video/mpeg',
          'mpg': 'audio/mpeg',
          'mpga': 'audio/mpeg',
          'mpp': 'application/vnd.ms-project',
          'mpt': 'application/x-project',
          'mpv': 'application/x-project',
          'mpx': 'application/x-project',
          'mrc': 'application/marc',
          'ms': 'application/x-troff-ms',
          'mv': 'video/x-sgi-movie',
          'my': 'audio/make',
          'mzz': 'application/x-vnd.audioexplosion.mzz',
          'nap': 'image/naplps',
          'naplps': 'image/naplps',
          'nc': 'application/x-netcdf',
          'ncm': 'application/vnd.nokia.configuration-message',
          'nif': 'image/x-niff',
          'niff': 'image/x-niff',
          'nix': 'application/x-mix-transfer',
          'nsc': 'application/x-conference',
          'nvd': 'application/x-navidoc',
          'o': 'application/octet-stream',
          'oda': 'application/oda',
          'omc': 'application/x-omc',
          'omcd': 'application/x-omcdatamaker',
          'omcr': 'application/x-omcregerator',
          'p': 'text/x-pascal',
          'p10': 'application/pkcs10',
          'p12': 'application/pkcs-12',
          'p7a': 'application/x-pkcs7-signature',
          'p7c': 'application/pkcs7-mime',
          'p7m': 'application/pkcs7-mime',
          'p7r': 'application/x-pkcs7-certreqresp',
          'p7s': 'application/pkcs7-signature',
          'part': 'application/pro_eng',
          'pas': 'text/pascal',
          'pbm': 'image/x-portable-bitmap',
          'pcl': 'application/vnd.hp-pcl',
          'pct': 'image/x-pict',
          'pcx': 'image/x-pcx',
          'pdb': 'chemical/x-pdb',
          'pdf': 'application/pdf',
          'pfunk': 'audio/make',
          'pgm': 'image/x-portable-graymap',
          'pic': 'image/pict',
          'pict': 'image/pict',
          'pkg': 'application/x-newton-compatible-pkg',
          'pko': 'application/vnd.ms-pki.pko',
          'pl': 'text/plain',
          'plx': 'application/x-pixclscript',
          'pm': 'image/x-xpixmap',
          'pm4': 'application/x-pagemaker',
          'pm5': 'application/x-pagemaker',
          'png': 'image/png',
          'pnm': 'application/x-portable-anymap',
          'pot': 'application/mspowerpoint',
          'pov': 'model/x-pov',
          'ppa': 'application/vnd.ms-powerpoint',
          'ppm': 'image/x-portable-pixmap',
          'pps': 'application/mspowerpoint',
          'ppt': 'application/mspowerpoint',
          'ppz': 'application/mspowerpoint',
          'pre': 'application/x-freelance',
          'prt': 'application/pro_eng',
          'ps': 'application/postscript',
          'psd': 'application/octet-stream',
          'pvu': 'paleovu/x-pv',
          'pwz': 'application/vnd.ms-powerpoint',
          'py': 'text/x-script.phyton',
          'pyc': 'application/x-bytecode.python',
          'qcp': 'audio/vnd.qcelp',
          'qd3': 'x-world/x-3dmf',
          'qd3d': 'x-world/x-3dmf',
          'qif': 'image/x-quicktime',
          'qt': 'video/quicktime',
          'qtc': 'video/x-qtc',
          'qti': 'image/x-quicktime',
          'qtif': 'image/x-quicktime',
          'ra': 'audio/x-pn-realaudio',
          'ram': 'audio/x-pn-realaudio',
          'ras': 'application/x-cmu-raster',
          'rast': 'image/cmu-raster',
          'rexx': 'text/x-script.rexx',
          'rf': 'image/vnd.rn-realflash',
          'rgb': 'image/x-rgb',
          'rm': 'application/vnd.rn-realmedia',
          'rmi': 'audio/mid',
          'rmm': 'audio/x-pn-realaudio',
          'rmp': 'audio/x-pn-realaudio',
          'rng': 'application/ringing-tones',
          'rnx': 'application/vnd.rn-realplayer',
          'roff': 'application/x-troff',
          'rp': 'image/vnd.rn-realpix',
          'rpm': 'audio/x-pn-realaudio-plugin',
          'rt': 'text/richtext',
          'rtf': 'application/rtf',
          'rtx': 'application/rtf',
          'rv': 'video/vnd.rn-realvideo',
          's': 'text/x-asm',
          's3m': 'audio/s3m',
          'saveme': 'application/octet-stream',
          'sbk': 'application/x-tbook',
          'scm': 'application/x-lotusscreencam',
          'sdml': 'text/plain',
          'sdp': 'application/sdp',
          'sdr': 'application/sounder',
          'sea': 'application/sea',
          'set': 'application/set',
          'sgm': 'text/sgml',
          'sgml': 'text/sgml',
          'sh': 'application/x-bsh',
          'shar': 'application/x-bsh',
          'shtml': 'text/html',
          'sid': 'audio/x-psid',
          'sit': 'application/x-sit',
          'skd': 'application/x-koan',
          'skm': 'application/x-koan',
          'skp': 'application/x-koan',
          'skt': 'application/x-koan',
          'sl': 'application/x-seelogo',
          'smi': 'application/smil',
          'smil': 'application/smil',
          'snd': 'audio/basic',
          'sol': 'application/solids',
          'spc': 'application/x-pkcs7-certificates',
          'spl': 'application/futuresplash',
          'spr': 'application/x-sprite',
          'sprite': 'application/x-sprite',
          'src': 'application/x-wais-source',
          'ssi': 'text/x-server-parsed-html',
          'ssm': 'application/streamingmedia',
          'sst': 'application/vnd.ms-pki.certstore',
          'step': 'application/step',
          'stl': 'application/sla',
          'stp': 'application/step',
          'sv4cpio': 'application/x-sv4cpio',
          'sv4crc': 'application/x-sv4crc',
          'svf': 'image/vnd.dwg',
          'svr': 'application/x-world',
          'swf': 'application/x-shockwave-flash',
          't': 'application/x-troff',
          'talk': 'text/x-speech',
          'tar': 'application/x-tar',
          'tbk': 'application/toolbook',
          'tcl': 'application/x-tcl',
          'tcsh': 'text/x-script.tcsh',
          'tex': 'application/x-tex',
          'texi': 'application/x-texinfo',
          'texinfo': 'application/x-texinfo',
          'text': 'application/plain',
          'tgz': 'application/gnutar',
          'tif': 'image/tiff',
          'tiff': 'image/tiff',
          'tr': 'application/x-troff',
          'tsi': 'audio/tsp-audio',
          'tsp': 'application/dsptype',
          'tsv': 'text/tab-separated-values',
          'turbot': 'image/florian',
          'txt': 'text/plain',
          'uil': 'text/x-uil',
          'uni': 'text/uri-list',
          'unis': 'text/uri-list',
          'unv': 'application/i-deas',
          'uri': 'text/uri-list',
          'uris': 'text/uri-list',
          'ustar': 'application/x-ustar',
          'uu': 'application/octet-stream',
          'uue': 'text/x-uuencode',
          'vcd': 'application/x-cdlink',
          'vcs': 'text/x-vcalendar',
          'vda': 'application/vda',
          'vdo': 'video/vdo',
          'vew': 'application/groupwise',
          'viv': 'video/vivo',
          'vivo': 'video/vivo',
          'vmd': 'application/vocaltec-media-desc',
          'vmf': 'application/vocaltec-media-file',
          'voc': 'audio/voc',
          'vos': 'video/vosaic',
          'vox': 'audio/voxware',
          'vqe': 'audio/x-twinvq-plugin',
          'vqf': 'audio/x-twinvq',
          'vql': 'audio/x-twinvq-plugin',
          'vrml': 'application/x-vrml',
          'vrt': 'x-world/x-vrt',
          'vsd': 'application/x-visio',
          'vst': 'application/x-visio',
          'vsw': 'application/x-visio',
          'w60': 'application/wordperfect6.0',
          'w61': 'application/wordperfect6.1',
          'w6w': 'application/msword',
          'wav': 'audio/wav',
          'wb1': 'application/x-qpro',
          'wbmp': 'image/vnd.wap.wbmp',
          'web': 'application/vnd.xara',
          'wiz': 'application/msword',
          'wk1': 'application/x-123',
          'wmf': 'windows/metafile',
          'wml': 'text/vnd.wap.wml',
          'wmlc': 'application/vnd.wap.wmlc',
          'wmls': 'text/vnd.wap.wmlscript',
          'wmlsc': 'application/vnd.wap.wmlscriptc',
          'word': 'application/msword',
          'wp': 'application/wordperfect',
          'wp5': 'application/wordperfect',
          'wp6': 'application/wordperfect',
          'wpd': 'application/wordperfect',
          'wq1': 'application/x-lotus',
          'wri': 'application/mswrite',
          'wrl': 'application/x-world',
          'wrz': 'model/vrml',
          'wsc': 'text/scriplet',
          'wsrc': 'application/x-wais-source',
          'wtk': 'application/x-wintalk',
          'xbm': 'image/x-xbitmap',
          'xdr': 'video/x-amt-demorun',
          'xgz': 'xgl/drawing',
          'xif': 'image/vnd.xiff',
          'xl': 'application/excel',
          'xla': 'application/excel',
          'xlb': 'application/excel',
          'xlc': 'application/excel',
          'xld': 'application/excel',
          'xlk': 'application/excel',
          'xll': 'application/excel',
          'xlm': 'application/excel',
          'xls': 'application/excel',
          'xlt': 'application/excel',
          'xlv': 'application/excel',
          'xlw': 'application/excel',
          'xm': 'audio/xm',
          'xml': 'application/xml',
          'xmz': 'xgl/movie',
          'xpix': 'application/x-vnd.ls-xpix',
          'xpm': 'image/x-xpixmap',
          'x-png': 'image/png',
          'xsr': 'video/x-amt-showrun',
          'xwd': 'image/x-xwd',
          'xyz': 'chemical/x-pdb',
          'z': 'application/x-compress',
          'zip': 'application/x-compressed',
          'zoo': 'application/octet-stream',
          'zsh': 'text/x-script.zsh'
        };

        return mimes[ext];
      }
    }

    return '';
  }
}]);


angular.module('dashboard.services.GeneralModel', [
  'dashboard.services.FileUpload',
  'dashboard.Config',
  'dashboard.Utils',
  'ngCookies'
])

.service('GeneralModelService', ['$cookies', '$q', 'Config', 'Utils', 'FileUploadService', function($cookies, $q, Config, Utils, FileUploadService) {
  "ngInject";

  var self = this;

  /**
   * Returns a list of models given filter params (see loopback.io filters)
   */
  this.list = function(apiPath, params, options) {
    var apiPath = apiPath + (apiPath.indexOf('?')>-1 ? '&' : '?') + 'access_token=' + $cookies.get('accessToken');
    if (!options || !options.preventCancel) Utils.apiCancel('GET', apiPath); //cancels any prior calls to method + path
    return Utils.apiHelper('GET', apiPath, params);
  };
  
  /**
   * Returns the total number of records for a given model
   */
  this.count = function(apiPath, params) {
    if( apiPath.indexOf('?')>-1 ) apiPath = apiPath.substr(0,apiPath.indexOf('?'));
    var keys = Object.keys(params);
    for (var i in keys) {
      var key = keys[i];
      if (key.indexOf("filter[where]") > -1) {
        newKey = key.replace("filter[where]", "where"); //count REST API uses where instead of filter[where]
        params[newKey] = params[key]; 
      } else if (key == "filter") {
        params.where = params.filter.where;
      }
    }
    apiPath = apiPath + '/count?access_token=' + $cookies.get('accessToken');
    Utils.apiCancel('GET', apiPath); //cancels any prior calls to method + path
    return Utils.apiHelper('GET', apiPath, params);
  };

  /**
   * Get the model data for a particular ID
   */
  this.get = function(model, id, params) {
    var apiPath = model + '/' + id + '?access_token=' + $cookies.get('accessToken');
    //Below Utils.apiCancel() call appears to break when getting user profile
    //Utils.apiCancel('GET', apiPath); //cancels any prior calls to method + path
    return Utils.apiHelper('GET', apiPath, params);
  };

  /**
   * For loopback.io hasMany relationship (see ModelFieldReference directive)
   */
  this.getMany = function(sourceModel, sourceId, relationship, params, options) {
    var path = sourceModel + '/' + sourceId + '/' + relationship;
    var apiPath = path + '?access_token=' + $cookies.get('accessToken');
    if (!options || !options.preventCancel) Utils.apiCancel('GET', apiPath); //cancels any prior calls to method + path
    return Utils.apiHelper('GET', apiPath, params);
  };


  this.sort = function(model, key, sortField, sortData) {
    var path = Config.serverParams.cmsBaseUrl + '/model/sort?access_token=' + $cookies.accessToken;
    var params = {
        model: model,
        key: key,
        sortField: sortField,
        sortData: sortData
    };
    return Utils.apiHelper('POST', path, params);
  };
  
  /**
   * Removes a record 
   */
  this.remove = function(model, id) {
    var path = model;
    if (id) {
      path = path + '/' + id;
    }
    path += '?access_token=' + $cookies.get('accessToken');
    return Utils.apiHelper('DELETE', path, {});

  };

  /**
   * Helper POST method
   */
  this.post = function(path, params) {
    var apiPath = path + '?access_token=' + $cookies.get('accessToken');
    return Utils.apiHelper('POST', apiPath, params);
  };


  /**
   * Upserts a record and its relationship data if provided
   * The CMS exposes the /model/save API that can take in model data
   * in hierarchical format
   */
  this.save = function(model, id, params) {
    var path = Config.serverParams.cmsBaseUrl + '/model/save';
    params.__model = model;
    params.__id = id;
    params.__accessToken = $cookies.get('accessToken');
    return Utils.apiHelper('PUT', path, params);
  };

  /**
   * Previously this was inside ModelEdit.js. It has been abstracted out and placed
   * in GeneralModelService so that projects that want to implement their own model edit UI
   * can call this method to perform file uploads and recursive model saves
   * @param model
   * @param id
   * @param data
   * @returns {promise.promise|Function|deferred.promise|{then, catch, finally}|*|r.promise}
   */
  this.saveWithFiles = function(model, id, data) {
    var modelDef = Config.serverParams.models[model];
    var deferred = $q.defer();

    var uploadImages = function(callback) {
      if (data.__ModelFieldImageData) {
        deferred.notify({message: "Uploading image file(s)", progress: 0, translate:"cms.status.uploading_image_files"});

        //First Upload Images and set Image Meta Data
        FileUploadService.uploadImages(data.__ModelFieldImageData)
          .then(function(result) {
            self.assignImageFileMetaData(modelDef, data, result);
            deferred.notify({message: "Saving...", progress: 0, translate:"cms.status.saving"});
            callback();
          }, function(error) {
            console.log(error);
            deferred.reject(error);
          }, function(progress) {
            deferred.notify({progress: progress});
          });
      } else {
        callback();
      }
    };

    var uploadFiles = function(callback) {
      //Uploading Non-Image Files (Look for fields with file type to upload in data)
      var index = 0;
      var keys = Object.keys(data);
      var nextFile = function() {
        if (index >= keys.length) {
          callback();
          return;
        }
        var key = keys[index];
        var field = data[key];
        if (field && typeof field === 'object' && field.file) {
          //Found file so upload it
          deferred.notify({message: "Uploading file: " + field.file.name, translate:"cms.status.uploading_file", params: { file: field.file.name }, progress:0});
          FileUploadService.uploadFile(field.file, field.path)
            .then(function(result) {
              data[key] = result.fileUrl;
              index++;
              nextFile();
            }, function(error) {
              if (typeof error === "object" && error.error) {
                deferred.reject({message:"The file being uploaded is not an accepted file type for this form", translate:"cms.error.file_upload.not_accepted"});
              } else {
                deferred.reject(error);
              }
            }, function(progress) {
              deferred.notify({progress: progress});
            });
        } else {
          index++;
          nextFile();
        }
      };
      nextFile();
    };

    uploadImages(function() {
      uploadFiles(function() {
        //Loop through fields and check for forced default fields
        self.checkDefaultValues(modelDef, data);
        self.save(model, id, data).then(
          function(result) {
            deferred.resolve(result);
          },
          function(error) {
            deferred.reject(error);
          });
      });
    });

    return deferred.promise;
  };

  /**
   * Assigns Meta Data returned from FileUploadService.uploadImages
   * @param modelDef
   * @param data
   * @param results
   */
  this.assignImageFileMetaData = function(modelDef, data, result) {
    //console.log("finished uploading");
    //console.log(JSON.stringify(result, null, '  '));

    //Loop through results and get URLs into scope.data
    var keys = Object.keys(result);
    for (var i in keys) {
      var fieldKey = keys[i]; //key represents the model field (column) name

      //Check the fieldKey properties
      var property = modelDef.properties[fieldKey]; //see model json properties
      var options = property.display.options;
      if (!options || !options.model || !options.relationship) {
        //store URL directly in model field value
        data[fieldKey] = result[fieldKey]; //response[key] is the image url
      } else {
        //Create a nested object in scope.data to mimic the relationship data structure for filter[include] in loopback.io
        if (!data[options.relationship]) data[options.relationship] = {};
        var mediaRelationshipModel = data[options.relationship];
        if (data[fieldKey]) mediaRelationshipModel[options.key] = data[fieldKey]; //assign the ID value if editing (i.e. mediaId)
        mediaRelationshipModel[options.urlKey] = result[fieldKey][options.urlKey];

        //Add export images
        var exportKeys = Object.keys(options.export);
        for (var j in exportKeys) {
          var exportKey = exportKeys[j];
          mediaRelationshipModel[exportKey] = result[fieldKey][exportKey];
        }

        //Add filename
        if (data.__ModelFieldImageData[fieldKey] && data.__ModelFieldImageData[fieldKey][options.urlKey]) {
          var fileInfo = data.__ModelFieldImageData[fieldKey][options.urlKey];
          var file = fileInfo ? fileInfo.file : {}; //First Image in __ModelFieldImageData will have { path, file } subsequent exports will just be the file
          mediaRelationshipModel.filename = file.name;
        } else {
          mediaRelationshipModel.filename = "unknown";
        }
        //Add any specified meta data field
        if (options.meta) {
          var metaKeys = Object.keys(options.meta);
          for (var k in metaKeys) {
            var metaKey = metaKeys[k];
            mediaRelationshipModel[metaKey] = options.meta[metaKey];
          }
        }
      }

    }

    //Finally delete the __ModelFieldImageData
    delete data.__ModelFieldImageData;
    delete data.__ModelFieldImageChangeCount;
  };

  /**
   * Loop through fields and check for forced default fields
   * Called by ModelEdit.js and saveWithFiles()
   * @param modelDef
   * @param data
   */
  this.checkDefaultValues = function(modelDef, data) {
    var keys = Object.keys(modelDef.properties);
    for (var i in keys) {
      var key = keys[i];
      var property = modelDef.properties[key];
      if ((property && property.display) && (typeof data[key] === 'undefined' || data[key] == null || property.display.forceDefaultOnSave)) {
        if (typeof property["default"] !== 'undefined') data[key] = property["default"];
        if (typeof property.display.evalDefault !=='undefined') data[key] = eval(property.display.evalDefault);
      }
    }

  };

    /**
     * Convert to JSON query string parameter in the form of filter[where][and][0][isDeleted] = 1
     * @param params
     */
  this.queryStringParamsToJSON = function(params) {
    var json = {};
    _.forEach(params, function(value, key) {
      json = _.set(json, key, value);
    });
    return json;
  };

  this.validateRequiredFields = function(model, data, displayName) {
    var display = (displayName) ? model[displayName] : model.display;
    var invalids = display.filter(function(item) {
      if (typeof item === 'string') {
        var property = model.properties[item];
        return (property && property.required && !data[item]);
      } else if(typeof item === 'object' && item.required) {
        if (item.options && item.options.relationship) {
          return _.isEmpty(data[item.options.relationship]);
        } else if (item.type === 'image') {
          if (data.__ModelFieldImageData) {
            return _.isEmpty(data.__ModelFieldImageData[item.property]);
          }
          return _.isEmpty(data[item.property]);
        }
        return _.isEmpty(data[item.property]);
      }
      return false;
    });
    return _.isEmpty(invalids);
  };
}]);


angular.module('dashboard.services.Image', [])

.service('ImageService', ['$q', function($q) {
  "ngInject";

	var self = this;
  
  /**
   * Resizes the image and fixes orientation if uploading from mobile device
   * @param dataURI - Image URL or Data URI
   * @param options
   *  - width
   *  - height
   *  - aspect: stretch, fill, fit
   * @param callback
   */
  this.resize = function(dataURI, options, callback) {
    self.loadImageURI(dataURI, function(error, image) {
      if (error) return callback(error);
      EXIF.getData(image, function(exif) {
        var canvas = document.createElement("canvas");
        var context = canvas.getContext("2d");
        var orientation = EXIF.getTag(this, "Orientation");
        //console.log('EXIF', EXIF.pretty(this))
        if (!options) options = {};
        var width = options.width ? options.width : image.width;
        var height = options.height ? options.height : image.height;
        var aspect = options.aspect ? options.aspect : 'fit';
        switch(aspect) {
          case "stretch":
            canvas.width = width;
            canvas.height = height;
            break;
          case "fill":
            canvas.width = width;
            canvas.height = height;
            var scale = Math.max(width / image.width, height / image.height);
            width = image.width * scale;
            height = image.height * scale;
            break;
          case "fit":
          default:
            var scale = Math.min(width / image.width, height / image.height);
            if (scale > 1.0) scale = 1.0; //don't enlarge the image
            width = image.width * scale;
            height = image.height * scale;
            canvas.width = width;
            canvas.height = height;
            break;
        }
        context.save();
        self.setOrientation(canvas, context, width, height, orientation);
        context.drawImage(image, 0, 0, width, height);
        context.restore();

        try {
          var dataUrl = canvas.toDataURL("image/jpeg", 0.8);
          callback(null, dataUrl);
        } catch(e) {
          callback(null, dataURI);
        }

      });
    });    
  };

  this.fixOrientationWithDataURI = function(dataURI, callback) {
    self.resize(dataURI, {}, callback);
  };

  this.setOrientation = function(canvas, context, width, height, orientation) {
    //EXIF orientation
    switch (orientation) {
      case 2:
        // horizontal flip
        context.translate(width, 0);
        context.scale(-1, 1);
        break;
      case 3:
        // 180° rotate left
        context.translate(width, height);
        context.rotate(Math.PI);
        break;
      case 4:
        // vertical flip
        context.translate(0, height);
        context.scale(1, -1);
        break;
      case 5:
        // vertical flip + 90 rotate right
        canvas.width = height;
        canvas.height = width;
        context.rotate(0.5 * Math.PI);
        context.scale(1, -1);
        break;
      case 6:
        // 90° rotate right
        canvas.width = height;
        canvas.height = width;
        context.rotate(0.5 * Math.PI);
        context.translate(0, -height);
        break;
      case 7:
        // horizontal flip + 90 rotate right
        canvas.width = height;
        canvas.height = width;
        context.rotate(0.5 * Math.PI);
        context.translate(width, -height);
        context.scale(-1, 1);
        break;
      case 8:
        // 90° rotate left
        canvas.width = height;
        canvas.height = width;
        context.rotate(-0.5 * Math.PI);
        context.translate(-width, 0);
        break;
    }
  };

  this.loadImageURI = function(imageUrl, callback) {
    var image = new Image();
    image.onload = function() {
      callback(null, image);
    };
    image.onerror = function(error) {
      callback(error);
    };

    image.src = imageUrl;
  };
  
}])

;
angular.module('dashboard.services.Location', [
  'dashboard.Config',
  'dashboard.Utils'
])

.service('LocationService', ['Config', 'Utils', '$q', '$rootScope', function(Config, Utils, $q, $rootScope) {
  "ngInject";

  var d = $q.defer();
  this.currentLocation = function() {
    // HTML5 geolocator
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(function(position) {
        $rootScope.$apply(function () {
            d.resolve(position.coords);
        });
      }, function(error) {
        d.reject(error);
      });
    } else {
      // Browser doesn't support Geolocation
      d.reject('location services not allowed');
    }
    return d.promise;
  };
}]);

angular.module('dashboard.services.Session', [
  'dashboard.Utils',
  'dashboard.services.User',
  'ngCookies'
])

.service('SessionService', ['$cookies', '$cookieStore', '$q', 'UserService', 'Config', 'Utils', 'DashboardService', function($cookies, $cookieStore, $q, UserService, Config, Utils, DashboardService) {
  "ngInject";

  var self = this;
  
  var session = null;
  function init() {
    var sessionStr = $cookies.get('session');
    if (sessionStr) {
      session = JSON.parse(sessionStr);
    }
  }

  this.logIn = function(email, password, options) {
    var authModel = "Users";
    if (config.authModel) authModel = config.authModel;
    return Utils.apiHelper('POST', authModel + '/login?include=user', { email: email, password: password,  options: options})
    .then(function(userInfo) {
      return self.setSession(userInfo);
    })
    ["catch"](function() {
      $cookies.put('session', null);
      return $q.reject(arguments);
    });
  };

  this.logOut = function() {
  	var authModel = "Users";
  	if (config.authModel) authModel = config.authModel;
		var accessToken = $cookies.get('accessToken');
		$cookieStore.remove('username');
		$cookieStore.remove('userId');
		$cookieStore.remove('accessToken');
		$cookieStore.remove('roles');
		$cookieStore.remove('session');
    $cookieStore.remove('lastActive');
	  return Utils.apiHelper('POST', authModel + '/logout?access_token=' + accessToken);
  };

  this.setSession = function(userInfo) {
    var authModel = "Users";
    if (config.authModel) authModel = config.authModel;
    return Utils.apiHelper('GET', authModel + '/' + userInfo.userId + '/Roles?access_token=' + userInfo.id)
      .then(function(roles) {
        $cookies.put('lastActive', new Date());//initiallize after successful login
        session = userInfo;
        $cookies.put('username', userInfo.user.username);
        $cookies.put('userId', userInfo.userId);
        $cookies.put('accessToken', userInfo.id);
        $cookies.put('session', JSON.stringify(session));
        $cookies.put('roles', JSON.stringify(roles));
        return userInfo;
      })["catch"](function() {
      $cookies.put('session', null);
      return $q.reject(arguments);
    });
  };

  this.getAuthToken = function() {
    return session && session.id;
  };

  /**
	 * Stores a key/value pair in session object
   * @param key
   * @param value
   */
  this.put = function(key, value) {
    var session = JSON.parse($cookies.get('session'));
    session[key] = value;
    $cookies.put('session', JSON.stringify(session));
  };

  this.get = function(key) {
    var session = JSON.parse($cookies.get('session'));
    return session[key];
  };

  this.isAuthorized = function(toState, toParams) {
    if(_.startsWith(toState.name, 'public')) return true;//always allow public routes
    var nav = DashboardService.getNavigation();
    var state = toState.name;
    //dashboard.model.action.route
    var path = toParams.model; // model = config.nav[].path
    var label = toParams.action;// action = config.nav[].label
    var roles = angular.fromJson($cookies.get('roles'));

    if(!_.isEmpty(path)) { //check subnavs
      var found = _.find(nav, { path: path });
      if(found) {
        if(!DashboardService.hasAccess(roles, found)) return false;
        if(_.isArray(found.subnav) && !_.isEmpty(label)) {
          var subnav = _.find(found.subnav, { label: label });
          if(subnav) return DashboardService.hasAccess(roles, subnav);
        }
      }
    } else { // check top nav using state
      var found = _.find(nav, { state: state });
      if(found) return DashboardService.hasAccess(roles, found);
    }

    var ctrlRoles = toState.data['roles'];
    if(!_.isEmpty(ctrlRoles) && _.isArray(ctrlRoles)) {
      return DashboardService.hasAccess(roles, { roles: ctrlRoles });
    }

    return true;//no restrictions found, allow access for backwards compatibility
  };

  init();
}])

;

angular.module('dashboard.services.Settings', [
  'dashboard.Config',
  'dashboard.Utils',
  'ngCookies'
])

.service('SettingsService', ['$cookies', 'Config', 'Utils', function($cookies, Config, Utils) {
  "ngInject";

  this.saveNav = function(nav) {
    var path = Config.serverParams.cmsBaseUrl + '/settings/config/nav?access_token=' + $cookies.get('accessToken');
    return Utils.apiHelper('POST', path, nav);
  };
  
}])

;

angular.module('dashboard.services.User', [
  'dashboard.Config',
  'dashboard.Utils'
])

.service('UserService', ['Config', 'Utils', '$q', '$rootScope', function(Config, Utils, $q, $rootScope) {
  "ngInject";

  this.register = function(email, password) {
	  var authModel = "Users";
	  if (config.authModel) authModel = config.authModel; 
	  return Utils.apiHelper('POST', authModel, { email: email, password: password });
  };
}]);

angular.module('dashboard.Utils', [
  'dashboard.Config'
])

.service('Utils', ['Config', '$http', '$q', function(Config, $http, $q) {
  "ngInject";

  var apiRequests = {}; //stores active http requests using method+path as key
  
  /**
   * Allows for cancelling prior API calls matching the method + path
   */
  this.apiCancel = function(method, path) {
    var canceller = apiRequests[method+":"+path];
    if (canceller && canceller.resolve) {
      canceller.resolve();
    }
    delete apiRequests[method+":"+path];
  };
  
  /**
   * Implements an http call and returns promise
   */
  this.apiHelper = function(method, path, data, params) {
    var deferred = $q.defer();
    params = params || {};
    params.method = method;
    if (path[0] == "/") {
      params.url = path;
    } else {
      if (Config.apiBaseUrl && Config.apiBaseUrl[Config.apiBaseUrl.length-1] != '/' && path[path.length-1] != '/') {
        Config.apiBaseUrl += '/';
      }
      params.url = Config.apiBaseUrl + path;
    }
    
    if (method == 'POST' || method == 'PUT') {
      params.data = data;
    } else {
      params.params = data;
    }
    
    apiRequests[method+":"+path] = deferred;
    params.timeout = deferred.promise; 
    $http(params)
      .then(function(response) {
        deferred.resolve(response.data);
      }, function(response) {
        deferred.reject(response.data);
      });

    return deferred.promise; 
  };
}]);

//JQuery >= 2.2 deprecated this function
$.swap = function (elem, options, callback, args) {
  var ret, name, old = {};

  // Remember the old values, and insert the new ones
  for (name in options) {
    old[name] = elem.style[name];
    elem.style[name] = options[name];
  }

  ret = callback.apply(elem, args || []);

  // Revert the old values
  for (name in options) {
    elem.style[name] = old[name];
  }

  return ret;
};
(function ( window, angular, undefined ) {

})( window, window.angular );
