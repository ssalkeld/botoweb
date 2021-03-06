/**
 * @author    Ian Paterson
 * @namespace boto_web.ui.object
 */

/**
 * Encapsulates content related to a particular object and provides access to
 * that object's properties.
 *
 * @param html an HTML document fragment for parsing.
 */
boto_web.ui.Object = function(html, model, obj, opts) {
	var self = this;

	if (!opts)
		opts = {};

	self.model = model;
	self.obj = obj || {properties: {}};
	self.node = $(html);
	self.guid = self.model.name + '_' + self.obj.id;
	self.parent = opts.parent;
	self.editing_templates = {};
	self.fields = [];
	self.data_tables = opts.data_tables || [];
	self.opts = opts;

	self.get_link = function(method, data, node) {
		var base_url = document.location.href + '';
		base_url = base_url.replace(/action=.*?(&|$)/,'');
		if (base_url.indexOf('?') == -1)
			base_url += '?';
		else
			base_url += '&';

		switch (method) {
			case 'view':
				if (data)
					return boto_web.env.base_url + self.model.href + '/' + self.obj.id + '/' + escape(data);

				return '#' + boto_web.env.opts.model_template.replace('*', self.model.name) + '?id=' + self.obj.id;
			// TODO phase out update(properties) in favor of edit(properties)
			case 'update':
			case 'edit':
				if (data)
					return base_url + 'action=update/' + self.model.name + '/' + self.obj.id + '&data=' + escape(data);

				return '#' + boto_web.env.opts.model_template.replace('*', self.model.name) + '?id=' + self.obj.id + '&action=edit';

				return base_url + 'action=edit/' + self.model.name + '/' + self.obj.id;
			case 'clone':
				return '#' + boto_web.env.opts.model_template.replace('*', self.model.name) + '?id=' + self.obj.id + '&action=clone';
			case 'delete':
				return base_url + 'action=delete/' + self.model.name + '/' + self.obj.id;
			case 'mailto':
				if (data)
					return "mailto:" + self.obj.properties[data];
				return "mailto:" + self.obj.properties['email'];
			case 'attr':
				if(data) {
					return self.obj.properties[data];
				} else {
					return $(node).text();
				}
		}
	};

	/**
	 * Insert values from the object into the html markup.
	 */
	self.parse_markup = function() {
		self.nested_obj_nodes = [];

		// Check conditional functions which might drop sections from the DOM
		sel = boto_web.ui.selectors.condition;
		prop =  boto_web.ui.properties.condition;

		self.node.find(sel).each(function() {
			var val = $(this).attr(prop);
			if (boto_web.env.opts.conditions && val in boto_web.env.opts.conditions){
				var ret = boto_web.env.opts.conditions[val](self.obj, this, self);
				if(ret === false){
					$(this).remove();
				}
			} else {
				$(this).hide();
			}
		});

		// Fire off any triggers
		sel = boto_web.ui.selectors.trigger;
		prop =  boto_web.ui.properties.trigger;

		self.node.find(sel).each(function() {
			var val = $(this).attr(prop);
			if (boto_web.env.opts.triggers && val in boto_web.env.opts.triggers)
				boto_web.env.opts.triggers[val](self.obj, this, self);
		});


		// Add relational links to other objects
		sel = boto_web.ui.selectors.relations;

		self.node.find(sel).each(function() {
			var props = $(this).attr(boto_web.ui.properties.attributes) || 'all';

			if (props != 'all')
				props = props.split(',');

			var relations = [];

			// Find any relations matching the props list
			for (var prop in self.obj.properties) {
				if (self.obj.properties[prop].type == 'reference' && (props == 'all' || $.inArray(prop, props) >= 0)) {
					relations.push(self.obj.properties[prop]);
				}
			}

			var node = $(this).clone();

			for (var i in relations) {
				var model = boto_web.env.models[self.model.prop_map[relations[i].name]._item_type];
				(function(results, prop) {
					self.obj.follow(prop, function(data, page, count) {
						results.update(data, page, count);

						return true;
					});
				})(new boto_web.ui.widgets.SearchResults(node.clone().appendTo($(this).parent()), model), relations[i].name);
			}

			$(this).remove();

			// If no relations are found, return an error
			if (props.length == 0) {
				$($(this).attr(prop)).log(self.model.name + ' no valid relations found');
				return;
			}
		});

		// Insert object attributes
		self.parse_attributes();

		// Add attribute lists
		sel = boto_web.ui.selectors.attribute_list;

		var attribute_lists = 0;

		self.node.find(sel).each(function() {
			attribute_lists++;
			new boto_web.ui.widgets.AttributeList(this, self.model);
		});

		if (attribute_lists)
			self.parse_attributes({attribute_lists: true});

		// Insert object attributes as classNames
		/*sel = boto_web.ui.selectors.class_name;
		prop = boto_web.ui.properties.class_name;
		self.parse_attributes({sel:sel, prop:prop});*/

		// Toggle details
		sel = boto_web.ui.selectors.details;

		self.node.find(sel).each(function() {
			$(this).find('legend').click(function() {
				$(this.parentNode).find('.widget-attribute_list').toggle();
			});
		});

		// Insert datetimes
		sel = boto_web.ui.selectors.date_time;

		self.node.find(sel).each(function() {
			new boto_web.ui.widgets.DateTime(this);
		});

		// Add editing tools
		sel = boto_web.ui.selectors.editing_tools;

		self.node.find(sel).each(function() {
			new boto_web.ui.widgets.EditingTools(this, self.model, ($(this).attr(boto_web.ui.properties.attributes) || ''));
		});

		// Add links
		sel = boto_web.ui.selectors.link;
		prop =  boto_web.ui.properties.link;

		self.node.find(sel).each(function() {
			// Translate
			var val = $(this).attr(prop);

			if (!val)
				return;

			var data;
			if (/(.*)\((.*)\)/.test(val)) {
				val = RegExp.$1;
				data = RegExp.$2;
			}

			var model = self.model;

			if (val == 'create') {
				if ($(this).is(boto_web.ui.selectors.model))
					model = $(this).attr(boto_web.ui.properties.model);
				else
					model = $(this).parents(boto_web.ui.selectors.model + ':eq(0)').attr(boto_web.ui.properties.model);

				model = boto_web.env.models[model] || '';
			}

			var method = {'create':'post', 'clone':'post', 'view':'get', 'update':'put', 'edit':'put', 'delete':'delete', 'mailto': 'get', 'attr': 'get'}[val];

			// Only allow view, edit, or delete and only if that action is allowed
			// according to the model API.
			if (!(method && model && model.methods && method in model.methods)) {
				$(val).log(model.name + ' does not support action ' + val);
				return;
			}

			// Get defaults for the create form.
			if (val == 'create' && data) {
				// Convert barewords to object property values
				while (/:\s*([a-z_]\w*)\s*(,|\})/i.test(data)) {
					data = data.replace(/:\s*([a-z_]\w*)\s*(,|\})/i, function(a,b,c) {
						return ': "' + self.obj.properties[b] + '"' + c;
					})
				}

				eval('data = ' + data);

				$(this).click(function(e) {
					model.create({def: data});
					e.preventDefault();
				})
			}
			else if (val == 'edit') {
				$(this).click(function(e) {
					self.edit();
					e.preventDefault();
				});
				return;
			}
			else if (val == 'clone') {
				$(this).click(function(e) {
					self.edit();
					self.obj.id = '';
					e.preventDefault();
				});
				return;
			}

			if($(this).attr('href')){
				$(this).attr('href',$(this).attr("href") +  self.get_link(val, data, this));
			} else {
				$(this).attr('href',self.get_link(val, data, this));
			}
		});

		$(self.nested_obj_nodes).each(function() {
			if (this[0].parentNode || 1) {
				if(this[0].tagName == "TD"){
					$(this[0]).append(this[1]);
				} else {
					$(this[0]).replaceWith(this[1]);
				}
				$(this[1]).trigger('ready');
			}
		});

		delete self.nested_obj_nodes;
	};

	self.submit = function() {
		var self = this;

		var data = {};
		var uploads = [];
		self.submitted = true;

		if (self.obj.id)
			data.id = self.obj.id;

		var has_nested = false;

		$(self.fields).each(function() {
			if (!this.field)
				return;

			var val;
			var name = this.field.attr('name');

			if (this.field.attr('type') == 'file') {
				uploads.push(this);
				return;
			}

			if (this.field_container.data('get_value'))
				val = this.field_container.data('get_value')();

			// Allow nested objects to submit
			if (val === false) {
				has_nested = true;
				return false;
			}

			if (typeof val == 'undefined')
				return;

			if (val != '' && (!self.obj || !self.obj.id) || self.obj && !$.equals((self.obj.properties[name] || ''), val))
				data[name] = val;
		});

		if (has_nested)
			return;

		if (!self.model)
			return;

		self.model.save(data, function(data) {
			self.submitted = true;
			if (data.status < 300) {
				var id = self.obj.id;
				if(!id && data.getResponseHeader("Location"))
					id = data.getResponseHeader('Location').replace(/.*\//, '');

				if (uploads.length) {
					var upload_fnc = function(obj) {
						var num_uploads = 0;

						$(uploads).each(function() {
							if ($(this.field).val()) {
								num_uploads++;
								$(this.field).parent('form').attr('action', boto_web.env.base_url + obj.href + '/' + obj.id + '/' + this.field.attr('name')).submit();
							}
						});

						self.obj.id = obj.id;

						if (num_uploads == 0) {
							boto_web.ui.alert('The database has been updated.');
							document.location.reload(true);
						}
						else {
							boto_web.ui.alert('Please press OK when your browser status bar indicates that the upload is complete.', 'Please wait for the upload to finish', function() {
								document.location.href = ('' + document.location.href).replace(/#.*/, self.get_link('view'))
								document.location.reload(true);
							});
						}
					};

					if (self.obj.id)
						upload_fnc(self.obj);
					else
						setTimeout(function() { self.model.get(id, upload_fnc) }, 500);
				}
				else if (self.parent) {
					self.obj.id = id;
					self.parent.submit();
				}
				else {
					self.obj.id = id;
					boto_web.ui.alert('The database has been updated.');
					document.location.href = ('' + document.location.href).replace(/#.*/, self.get_link('view'))
					document.location.reload(true);
				}

				if (opts.callback) {
					opts.callback();
				}
			}
			else {
				boto_web.ui.alert($(data.responseXML).find('message').text(), 'There was an error updating the database');
			}
		});
	};

	self.update_tables = function() {
		$(self.data_tables).each(function() {
			if (!this.table || !this.table.append)
				return;
			if (this.row != undefined)
				this.table.update(this.row, self.node);
			else {
				var rows = this.table.append([self.node]);
				if (rows)
					this.row = rows[0];
			}
		});

		if (self.parent)
			self.parent.update_tables();
	};

	self.edit = function(nested) {
		self.node.find(boto_web.ui.selectors.editing_tools).remove();

		$(self.fields).each(function() {
			this.field_container.siblings().hide();
			this.label.show();
			this.field_container.show();

			if (this.editing_template) {
				this.editing_template.edit(true);

				// When creating a new object, expand all nested objects for quicker input
				if (!self.obj.id)
					this.add_field();
			}

			/*
			if (this.properties.name in self.editing_templates) {
				var show_nested_editors = function(field) { return function() {
					var template = self.editing_templates[field.properties.name];

					if (template.used) {
						var n = template.node;
						template = template.clone();
						template.node.insertAfter(n);
					}

					template.used = true;

					template.edit()

					template.node
						.appendTo(field.field_container);

					// Only allow the Add button to be clicked once for non-lists
					if (!(field.properties._type in {list:1,query:1}))
						$(this).unbind();
				}}(this);

				if (this.button_new && !self.obj) {
					this.button_new.unbind()
						.click(show_nested_editors);
				}
				else
					show_nested_editors();
			}
			*/
		});

		if (!nested) {
			$('<a/>')
				.addClass('ui-button ui-state-default ui-corner-all')
				.html('<span class="ui-icon ui-icon-disk"></span>Save')
				.click(function() { self.submit() })
				.appendTo(self.node);
			$('<a/>')
				.addClass('ui-button ui-state-default ui-corner-all')
				.html('<span class="ui-icon ui-icon-cancel"></span>Cancel')
				.click(function() { document.location.reload(true);})
				.appendTo(self.node);
			$('<br class="clear"/>').appendTo(self.node);
		}
	};

	self.parse_attributes = function(opt) {
		if (!opt)
			opt = {};

		var needs_label = false;

		var sel = opt.sel;
		var prop = opt.prop;

		if (!opt.sel || !opt.prop)  {
			sel = boto_web.ui.selectors.attribute;
			prop = boto_web.ui.properties.attribute;
		}

		self.node.find(sel).each(function() {
			var val = $(this).attr(prop).split('.');
			var follow_props;

			// Allow a.b.c reference attribute following
			if (val.length > 1) {
				follow_props = val.splice(1);
				val = val[0];
			}
			else
				val = val[0];

			// Ignore nested attributes
			if (!val || !opt.attribute_lists && $(this).is(boto_web.ui.selectors.attribute_list + ' ' + sel)) {
				return;
			}

			if (!self.obj.properties)
				return;

			var editable = $(this).parents(boto_web.ui.selectors.editable).attr(boto_web.ui.properties.editable) == 'true' ? 'true' : '';

			if (/(false|true)/.test($(this).attr(boto_web.ui.properties.editable))) {
				editable = ((RegExp.$1 == 'true') ? 'true' : '');
			}

			$(this).attr(prop, '');
			var container = $(this);

			// Decide whether this is a valid property.
			if (val in self.model.properties && self.model.properties[val]._perm && $.inArray('read', self.model.properties[val]._perm) == -1) {
				$(val).log(self.model.name + ' does not support this property');
				$(this).empty();
				return;
			}

			var editing_template;

			// Load nested objects
			if (self.model.prop_map[val] && (self.model.prop_map[val]._type == 'list'
				|| self.model.prop_map[val]._type in boto_web.env.models
				|| self.model.prop_map[val]._item_type in boto_web.env.models)) {
				//container = $(this).clone();
				var node = $(this).clone();

				//console.log(val + ' ' + self.model.name);

				// Find the best container to hold the new content, if the tag with
				// this attribute is the only child in its parent object then we
				// can use the natural parent, otherwise we generate a new span.

				if ($(this).parent('ul,ol').length) {
					container = $(this).parent().clone();
					container.empty();
					self.nested_obj_nodes.push([$(this).parent(), container]);
				}
				else {
					container = $('<span/>');
					self.nested_obj_nodes.push([this, container]);
					$(this).empty();
				}

				$(this).attr(boto_web.ui.properties.attribute, '');

				// Follow references if this is a reference or query type
				if (self.model.prop_map[val]._item_type in boto_web.env.models) {
					if (!follow_props && !node.html())
						follow_props = ['name'];
					if (follow_props)
						node.attr(boto_web.ui.properties.attribute, follow_props.join('.'));
					else
						node.attr(boto_web.ui.properties.attribute, '');

					node.attr(boto_web.ui.properties.editable, editable);

					if (node.html() && !(val in self.editing_templates)) {
						needs_label = true;

						var n = node.clone();

						n.find(boto_web.ui.selectors.editing_tools).remove();

						var o = new boto_web.ui.Object(
							n.clone(true),
							boto_web.env.models[self.model.prop_map[val]._item_type],
							null,
							{parent: self}
						);

						o.clone = function(obj) {
							return new boto_web.ui.Object(
								n.clone(true),
								boto_web.env.models[self.model.prop_map[val]._item_type],
								obj,
								{parent: self, debug: 1}
							);
						};
						editing_template = o;
					}

					if (self.obj.follow) {
						var filters = $(this).attr(boto_web.ui.properties.filter);
						if(filters){
							// " will be converted to &quote; and other characters may be as well so we need to fix that
							filters = eval($('<div/>').html(filters).text());
						}
						self.obj.follow(val, function(objs) {
							$(objs).each(function(i, o) {
								var n = $('<span/>').append(node.clone()).appendTo(container);
								new boto_web.ui.Object(n, boto_web.env.models[o.properties.model], o, {parent: self});
							});
							self.update_tables();
						}, filters);
					}
					else if (!editing_template) {
						var n = $('<span/>').append(node.clone()).appendTo(container);
						new boto_web.ui.Object(n, boto_web.env.models[self.model.prop_map[val]._item_type], null, {parent: self});
					}
				}
				// For string lists, duplicate the node for each value
				else if (self.model.prop_map[val] && self.model.prop_map[val]._type == 'list') {
					var values = self.obj.properties[val];
					if (values) {
						if (!$.isArray(values))
							values = [values];

						$(values).each(function(i, v) {
							if (self.model.prop_map[val]._type == 'blob') {
								self.obj.load(val, function (html) {
									node.clone()
										.html(html)
										.appendTo(container);
								});
							}
							else {
								node.clone()
									.html(v.toString() + ((!node.is('li') && i + 1 != values.length) ? ', ' : ''))
									.appendTo(container);
							}
						});
					}
				}
			}
			else if (self.obj.properties && val in self.obj.properties) {
				if (this.tagName.toLowerCase() == 'img')
					$(this).attr('src', self.obj.properties[val]);
				else if (self.model.prop_map[val] && self.model.prop_map[val]._type == 'blob') {
					var node = $(this);
					self.obj.load(val, function (html) {
						$('<span/>').html(html).prependTo(node);
					});
				}
				else if (self.model.prop_map[val] && self.model.prop_map[val]._type == 'dateTime') {
					new boto_web.ui.widgets.DateTime($(this), self.obj.properties[val]);
				}
				else if (self.model.prop_map[val] && self.model.prop_map[val]._type == 'complexType') {
					$(this).html($.map(self.obj.properties[val], function(o) {
						return '<div class="p50 al jr">' + o.name + ' &rarr;</div><div class="p50 al">&nbsp;' + o.value + '</div><br class="clear" />';
					}).join(''));
				}
				else if (prop == boto_web.ui.properties.class_name) {
					$(this).addClass('model-' + self.obj.properties.model);
					$(this).addClass('value-' + self.obj.properties[val].toString().replace(/\s[\s\S]*$/, ''));
				}
				else {
					$(this).append($('<span/>').html(self.obj.properties[val].toString()));
				}
			}
			else {
				$(this).empty();
			}

			// If this is not an editable section, don't add an editing form
			if (!editable)
				return;

			if (val in self.model.prop_map && $.inArray('write', self.model.prop_map[val]._perm) >= 0) {
				var choices;

				// TODO Generalize complexType options
				if (self.obj.id && self.model.prop_map[val]._type == 'complexType') {
					choices = [{text: 'ID', value: 'id'}];
					if (self.obj.properties.primary_key && self.obj.properties.primary_key != 'id')
						choices.push({text: self.obj.properties.primary_key, value: self.obj.properties.primary_key});

					if (self.obj.properties.target_class_name) {
						$(boto_web.env.models[self.obj.properties.target_class_name].properties).each(function() {
							if ($.inArray('write', this._perm) >= 0)
								choices.push({text: this._label, value: this.name});
						});
						choices.sort(function(a,b) { return (a.text.toLowerCase() > b.text.toLowerCase()) ? 1 : -1; });
					}
				}

				var field = boto_web.ui.forms.property_field($.extend(self.model.prop_map[val], {name: val, value: self.obj.properties[val] || ''}), {
					node: $(container),
					no_text: true,
					no_label: !needs_label,
					editing_template: editing_template,
					choices: choices,
					existing_only: $(this).is(boto_web.ui.selectors.existing_only),
					allow_default: !self.obj.id, // Only set defaults for new objects
					input_type: $(this).attr(boto_web.ui.properties.input_type)
				});
				self.fields.push(field);
				field.field_container.hide();
				field.label.hide();

				/*
				 * This is already done by the markup, doing it here duplicates the values.
				 *
				if (self.obj.properties[val] && self.obj.properties[val].type == 'reference') {
					self.obj.follow(val, function(field) { return function(objs) {
						$(objs).each(function() {
							field.add_field(this);
						});
					}}(field));
				}
				*/

				if (self.obj.properties[val] && field.opts.input_type && self.obj.properties[val].type == 'blob') {
					self.obj.load(val, function(field) { return function(content) {
						field.field.val(content);
					}}(field));
				}
			}
		});
	}

	self.parse_markup();

	self.update_tables();
};

