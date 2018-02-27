angular.module('dashboard.directives.ModelFieldApiMultiSelect', [])

.directive('modelFieldApiMultiSelect', function($compile, $timeout, GeneralModelService) {
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
        
        const apiPath = scope.options && scope.options.api ? scope.options.api : '';
        var params = {};
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
            const apiPath = scope.modelData.isQualifyingProject ? scope.options.qualifyingStatusApi : scope.options.trialApi;
            var output = {};
            var index;
            apiPath += scope.modelData.trialId;
            GeneralModelService.list(apiPath, {}, {preventCancel: true}).then(function(response) {
              for (var i=0; i<response.length; i++) {
                index = _.findIndex(scope.multiSelectOptions, {key: response[i].status});
                scope.selected[index] = true;
                output[scope.multiSelectOptions[index].key] = scope.multiSelectOptions[index].value;
              }
              if (response.length > 0) scope.data = output;
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
})

;
