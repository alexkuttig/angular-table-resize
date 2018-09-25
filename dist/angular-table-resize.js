angular.module("rzTable", []);

angular.module("rzTable").directive('rzTable', ['resizeStorage', '$injector', '$parse', function(resizeStorage, $injector, $parse) {

    var mode;
    var saveTableSizes;
    var profile;

    var columns = {};
    var ctrlColumns = {};
    var handleColumns = {};
    var listener = {};
    var handles = {}
    var table = {};
    var container = {};
    var resizer = {};
    var isFirstDrag = true;

    var cache = {};

    RzController.$inject = ['$scope', '$attrs', '$element'];

    function RzController($scope) {

    }

    function link(scope, element, attr) {
        // Set global reference to table
        table[scope.ident] = element;

        // initialize handles for table with id
        handles[scope.ident] = [];

        // Set global reference to container
        container[scope.ident] = scope.container ? $(scope.container) : $(table[scope.ident]).parent();

        // Set options to an empty object if undefined
        scope.options = attr.rzOptions ? scope.options || {} : {}

        // Add css styling/properties to table
        $(table[scope.ident]).addClass(scope.options.tableClass || 'rz-table');

        // Initialise handlers, bindings and modes
        initialiseAll(table, attr, scope);

        // Bind utility functions to scope object
        bindUtilityFunctions(table, attr, scope)

        // Watch for changes in columns
        watchTableChanges(table, attr, scope)

        // Watch for scope bindings
        setUpWatchers(table, attr, scope)
    }

    function renderWatch(table, attr, scope) {
      return function(oldVal, newVal) {
        if (scope.busy === true) return;
        if (newVal === undefined) return;
        if (newVal !== oldVal) {
          cleanUpAll(scope.ident);
          initialiseAll(table, attr, scope);
        }
      }
    }

    function setUpWatchers(table, attr, scope) {
        scope.$watch('profile', renderWatch(table, attr, scope));
        scope.$watch('mode', renderWatch(table, attr, scope));
        scope.$watch('busy', renderWatch(table, attr, scope));
    }

    function watchTableChanges(table, attr, scope) {
        scope.$watch(function () {
          return $(table[scope.ident]).find('th').length;
        }, renderWatch(table, attr, scope));
    }

    function bindUtilityFunctions(table, attr, scope, tableId) {
        if (!attr.rzModel) return;
        var model = $parse(attr.rzModel);
        model.assign(scope.$parent, {
            update: function() {
                cleanUpAll(tableId);
                initialiseAll(table, attr, scope, tableId);
            },
            reset: function() {
                resetTable(table, tableId);
                this.clearStorageActive();
                this.update();
            },
            clearStorage: function() {
                resizeStorage.clearAll();
            },
            clearStorageActive: function() {
                resizeStorage.clearCurrent(table, mode, profile, tableId);
            }
        })
    }

    function cleanUpAll(tableId) {
        isFirstDrag = true;
        deleteHandles(tableId);
    }

    function resetTable(table, tableId) {
        $(table[tableId]).outerWidth('100%');
        $(table[tableId]).find('th').width('auto');
    }

    function deleteHandles(tableId) {
        handles[tableId].map(function(h) { h.remove() })
        handles[tableId] = []
    }

    function initialiseAll(table, attr, scope) {
        // If busy, postpone initialization
        if (scope.busy) return;

        // Get all column headers
        columns[scope.ident] = $(table[scope.ident]).find('th');

        mode = scope.mode;


        saveTableSizes = angular.isDefined(scope.saveTableSizes) ? scope.saveTableSizes : true;
        profile = scope.profile;

        // Get the resizer object for the current mode
        var ResizeModel = getResizer(scope, attr);
        if (!ResizeModel) return;
        resizer[scope.ident] = new ResizeModel(table, columns, container, scope.ident);

        if (saveTableSizes) {
            // Load column sizes from saved storage
            cache[scope.ident] = resizeStorage.loadTableSizes(table, scope.mode, scope.profile, scope.ident)
        }

        // Decide which columns should have a handler attached
        handleColumns[scope.ident] = resizer[scope.ident].handles();

        // Decide which columns are controlled and resized
        ctrlColumns[scope.ident] = resizer[scope.ident].ctrlColumns;

        // Execute setup function for the given resizer mode
        resizer[scope.ident].setup();

        // Set column sizes from cache
        setColumnSizes(cache, scope.ident);

        // Initialise all handlers for every column
        handleColumns[scope.ident].each(function(index, column) {
            initHandle(scope, table, column);
        })

    }

    function initHandle(scope, table, column) {

        // Prepend a new handle div to the column
        var handle = $('<div>', {
            class: scope.options.handleClass || 'rz-handle'
        });
        $(column).prepend(handle);

        // Add handles to handles for later removal
        handles[scope.ident].push(handle)

        // Use the middleware to decide which columns this handle controls
        var controlledColumn = resizer[scope.ident].handleMiddleware(handle, column)

        // Bind mousedown, mousemove & mouseup events
        bindEventToHandle(scope, table, handle, controlledColumn);
    }

    function bindEventToHandle(scope, table, handle, column) {

        // This event starts the dragging
        $(handle).mousedown(function(event) {
            if (isFirstDrag) {
                resizer[scope.ident].onFirstDrag(column, handle);
                resizer[scope.ident].onTableReady();
                isFirstDrag = false;
            }

            scope.options.onResizeStarted && scope.options.onResizeStarted(column)

            var optional = {}
            if (resizer[scope.ident].intervene) {
                optional = resizer[scope.ident].intervene.selector(column);
                optional.column = optional;
                optional.orgWidth = $(optional).width();
            }

            // Prevent text-selection, object dragging ect.
            event.preventDefault();

            // Change css styles for the handle
            $(handle).addClass(scope.options.handleClassActive || 'rz-handle-active');

            // Get mouse and column origin measurements
            var orgX = event.clientX;
            var orgWidth = $(column).width();

            // On every mouse move, calculate the new width
            listener[scope.ident] = calculateWidthEvent(scope, column, orgX, orgWidth, optional, scope.ident)
            $(window).mousemove(listener[scope.ident])

            // Stop dragging as soon as the mouse is released
            $(window).one('mouseup', unbindEvent(scope, column, handle, table, event))
        })
    }

    function calculateWidthEvent(scope, column, orgX, orgWidth, optional, tableId) {
        return function(event) {
            // Get current mouse position
            var newX = event.clientX;

            // Use calculator function to calculate new width
            var diffX = newX - orgX;
            var newWidth = resizer[tableId].calculate(orgWidth, diffX);

            if (newWidth < getMinWidth(column)) return;
            if (resizer[tableId].restrict(newWidth, diffX)) return;

            // Extra optional column
            if (resizer[tableId].intervene){
                var optWidth = resizer[tableId].intervene.calculator(optional.orgWidth, diffX);
                if (optWidth < getMinWidth(optional.column)) return;
                if (resizer[tableId].intervene.restrict(optWidth, diffX)) return;
                $(optional.column).width(optWidth)
            }

            scope.options.onResizeInProgress && scope.options.onResizeInProgress(column, newWidth, diffX)

            // Set size
            $(column).width(newWidth);
        }
    }

    function getMinWidth(column) {
        // "25px" -> 25
        return parseInt($(column).css('min-width')) || 0;
    }

    function getResizer(scope, attr) {
        try {
            var mode = attr.rzMode ? scope.mode : 'BasicResizer';
            var Resizer = $injector.get(mode);
            return Resizer;
        } catch (e) {
            console.error("The resizer "+ scope.mode +" was not found");
            return null;
        }
    }


    function unbindEvent(scope, column, handle, table) {
        // Event called at end of drag
        return function( /*event*/ ) {
            $(handle).removeClass(scope.options.handleClassActive || 'rz-handle-active');

            if (listener[scope.ident]) {
                $(window).unbind('mousemove', listener[scope.ident]);
            }

            scope.options.onResizeEnded && scope.options.onResizeEnded(column);

            resizer[scope.ident].onEndDrag();

            saveColumnSizes(table, scope.ident);
        }
    }

    function saveColumnSizes(table, tableId) {
        if (!saveTableSizes) return;
        if (!cache[tableId]) cache[tableId] = {};
        $(columns[tableId]).each(function(index, column) {
            var colScope = angular.element(column).scope();
            var id = colScope.rzCol || $(column).attr('id');
            if (!id) return;
            cache[tableId][id] = resizer[tableId].saveAttr(column);
        });

        resizeStorage.saveTableSizes(table, mode, profile, cache, tableId);
    }

    function setColumnSizes(cache, tableId) {
        if (!cache[tableId]) {
            return;
        }

        $(table).width('auto');

        ctrlColumns[tableId].each(function(index, column){
            var colScope = angular.element(column).scope();
            var id = colScope.rzCol || $(column).attr('id');
            var cacheWidth = cache[tableId][id];
            $(column).css({ width: cacheWidth });
        });

        resizer[tableId].onTableReady();
    }

    // Return this directive as a object literal
    return {
        restrict: 'A',
        link: link,
        controller: RzController,
        scope: {
            // rzMode will determine the rezising behavior
            mode: '=rzMode',
            // identifier
            ident: '=rzIdent',
            // rzProfile loads a profile from local storage
            profile: '=?rzProfile',
            // rzBusy will postpone initialisation
            busy: '=?rzBusy',
            // rzSave saves columns to local storage
            saveTableSizes: '=?rzSave',
            // rzOptions supplies addition options
            options: '=?rzOptions',
            // rzModel binds utility function to controller
            model: '=rzModel',
            // rzContainer is a query selector for the container DOM
            container: '@rzContainer'
        }
    };

}]);

angular.module("rzTable").directive('rzCol', [function() {
  // Return this directive as a object literal
  return {
    restrict: 'A',
    priority: 650, /* before ng-if */
    link: link,
    require: '^^rzTable',
    scope: true
  };

  function link(scope, element, attr) {
    scope.rzCol = scope.$eval(attr.rzCol)
  }
}]);
angular.module("rzTable").service('resizeStorage', ['$window', function($window) {

    var prefix = "ngColumnResize";

    this.loadTableSizes = function(table, mode, profile, tableId) {
        var key = getStorageKey(table[tableId], mode, profile);
        var object = $window.localStorage.getItem(key);
        return JSON.parse(object);
    };

    this.saveTableSizes = function(table, mode, profile, cache, tableId) {
        var key = getStorageKey(table[tableId], mode, profile);
        if (!key) return;
        var string = JSON.stringify(cache[tableId]);
        $window.localStorage.setItem(key, string);
    };

    this.clearAll = function() {
        var keys = [];
        for (var i = 0; i < $window.localStorage.length; ++i) {
            var key = localStorage.key(i);
            if (key && key.startsWith(prefix)) {
                keys.push(key)
            }
        }
        keys.map(function(k) { $window.localStorage.removeItem(k) })
    };

    this.clearCurrent = function(table, mode, profile, tableId) {
        var key = getStorageKey(table[tableId], mode, profile);
        if (key) {
            $window.localStorage.removeItem(key)
        }
    }

    function getStorageKey(table, mode, profile) {
        var id = table.attr('id');
        if (!id) {
            console.error("Table has no id", table);
            return undefined;
        }
        return prefix + '.' + table.attr('id') + '.' + mode + (profile ? '.' + profile : '');
    }

}]);

angular.module("rzTable").factory("ResizerModel", [function() {

    function ResizerModel(table, columns, container, tableId){

        this.table = table[tableId];
        this.columns = columns[tableId];
        this.container = container[tableId];

        this.handleColumns = this.handles();
        this.ctrlColumns = this.ctrlColumns();
    }

    ResizerModel.prototype.setup = function() {
        // Hide overflow by default
        $(this.container).css({
            overflowX: 'hidden'
        })
    }

    ResizerModel.prototype.onTableReady = function () {
        // Table is by default 100% width
        $(this.table).outerWidth('100%');
    };

    ResizerModel.prototype.getMinWidth = function(column) {
        // "25px" -> 25
        return parseInt($(column).css('min-width')) || 0;
    }

    ResizerModel.prototype.handles = function () {
        // By default all columns should be assigned a handle
        return this.columns;
    };

    ResizerModel.prototype.ctrlColumns = function () {
        // By default all columns assigned a handle are resized
        return this.handleColumns;
    };

    ResizerModel.prototype.onFirstDrag = function () {
        // By default, set all columns to absolute widths
        $(this.ctrlColumns).each(function(index, column) {
            $(column).width($(column).width());
        })
    };

    ResizerModel.prototype.handleMiddleware = function (handle, column) {
        // By default, every handle controls the column it is placed in
        return column;
    };

    ResizerModel.prototype.restrict = function (newWidth) {
        return false;
    };

    ResizerModel.prototype.calculate = function (orgWidth, diffX) {
        // By default, simply add the width difference to the original
        return orgWidth + diffX;
    };

    ResizerModel.prototype.onEndDrag = function () {
        // By default, do nothing when dragging a column ends
        return;
    };

    ResizerModel.prototype.saveAttr = function (column) {
        return $(column).outerWidth();
    };

    return ResizerModel;
}]);

angular.module("rzTable").factory("BasicResizer", ["ResizerModel", function(ResizerModel) {

    function BasicResizer(table, columns, container, tableId) {
        // Call super constructor
        ResizerModel.call(this, table, columns, container, tableId)

        // All columns are controlled in basic mode
        this.ctrlColumns = this.columns;

        this.intervene = {
            selector: interveneSelector,
            calculator: interveneCalculator,
            restrict: interveneRestrict
        }
    }

    // Inherit by prototypal inheritance
    BasicResizer.prototype = Object.create(ResizerModel.prototype);

    function interveneSelector(column) {
        return $(column).next()
    }

    function interveneCalculator(orgWidth, diffX) {
        return orgWidth - diffX;
    }

    function interveneRestrict(newWidth){
        return newWidth < 25;
    }

    BasicResizer.prototype.setup = function() {
        // Hide overflow in mode fixed
        $(this.container).css({
            overflowX: 'hidden'
        })

        $(this.table).css({
            width: '100%'
        })
    };

    BasicResizer.prototype.handles = function() {
        // Mode fixed does not require handler on last column
        return $(this.columns).not(':last')
    };

    BasicResizer.prototype.onFirstDrag = function() {
        // Replace all column's width with absolute measurements
        this.onEndDrag()
    };

    BasicResizer.prototype.onEndDrag = function () {
        // Calculates the percent width of each column
        var totWidth = $(this.table).outerWidth();

        var callbacks = []

        // Calculate the width of every column
        $(this.columns).each(function(index, column) {
            var colWidth = $(column).outerWidth();
            var percentWidth = colWidth / totWidth * 100 + '%';
            callbacks.push(function() {
              $(column).css({ width: percentWidth });
            })
        })

        // Apply the calculated width of every column
        callbacks.map(function(cb) { cb() })
    };

    BasicResizer.prototype.saveAttr = function (column) {
        return $(column)[0].style.width;
    };

    // Return constructor
    return BasicResizer;

}]);

angular.module("rzTable").factory("FixedResizer", ["ResizerModel", function(ResizerModel) {

    function FixedResizer(table, columns, container, tableId) {
        // Call super constructor
        ResizerModel.call(this, table, columns, container, tableId);

        this.fixedColumn = $(table[tableId]).find('th').first();
        this.bound = false;
    }

    // Inherit by prototypal inheritance
    FixedResizer.prototype = Object.create(ResizerModel.prototype);

    FixedResizer.prototype.setup = function() {
        // Hide overflow in mode fixed
        $(this.container).css({
            overflowX: 'hidden'
        })

        $(this.table).css({
            width: '100%'
        })

        // First column is auto to compensate for 100% table width
        $(this.columns).first().css({
            width: 'auto'
        });
    };

    FixedResizer.prototype.handles = function() {
        // Mode fixed does not require handler on last column
        return $(this.columns).not(':last')
    };

    FixedResizer.prototype.ctrlColumns = function() {
        // In mode fixed, all but the first column should be resized
        return $(this.columns).not(':first');
    };

    FixedResizer.prototype.onFirstDrag = function() {
        // Replace each column's width with absolute measurements
        $(this.ctrlColumns).each(function(index, column) {
            $(column).width($(column).width());
        })
    };

    FixedResizer.prototype.handleMiddleware = function (handle, column) {
        // Fixed mode handles always controll next neightbour column
        return $(column).next();
    };

    FixedResizer.prototype.restrict = function (newWidth, diffX) {
        if (this.bound && this.bound < diffX) {
          this.bound = false
          return false
        } if (this.bound && this.bound > diffX) {
          return true
        } else if (this.fixedColumn.width() <= this.getMinWidth(this.fixedColumn)) {
            this.bound = diffX
            $(this.fixedColumn).width(this.minWidth);
            return true;
        }
    };

    FixedResizer.prototype.onEndDrag = function () {
        this.bound = false
    };

    FixedResizer.prototype.calculate = function (orgWidth, diffX) {
        // Subtract difference - neightbour grows
        return orgWidth - diffX;
    };

    // Return constructor
    return FixedResizer;

}]);

angular.module("rzTable").factory("OverflowResizer", ["ResizerModel", function(ResizerModel) {

    function OverflowResizer(table, columns, container, tableId) {
        // Call super constructor
        ResizerModel.call(this, table, columns, container, tableId)
    }

    // Inherit by prototypal inheritance
    OverflowResizer.prototype = Object.create(ResizerModel.prototype);


    OverflowResizer.prototype.setup = function() {
        // Allow overflow in this mode
        $(this.container).css({
            overflow: 'auto'
        });
    };

    OverflowResizer.prototype.onTableReady = function() {
        // For mode overflow, make table as small as possible
        $(this.table).width(1);
    };

    // Return constructor
    return OverflowResizer;

}]);
