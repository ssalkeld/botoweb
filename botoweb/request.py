import webob
import cgi
from botoweb.resources.user import User
import botoweb
import logging
log = logging.getLogger("botoweb.request")
from botoweb.response import Response
import time

CACHE_TIMEOUT = 300 # Keep user objects around for 300 seconds (5 minutes)
USER_CACHE = {}
def getCachedUser(username):
	if USER_CACHE.has_key(username):
		user, t = USER_CACHE[username]
		if (time.time() - t) < CACHE_TIMEOUT:
			return user
	return None

def addCachedUser(user):
	USER_CACHE[user.username] = (user, time.time())
	return user

class Request(webob.Request):
	"""We add in a few special extra functions for us here."""
	file_extension = "html"
	ResponseClass = Response

	def __init__(self, environ):
		self._user = None
		charset = 'ascii'
		content_type = environ.get("CONTENT_TYPE", environ.get("HTTP_CONTENT_TYPE", ""))
		if content_type.find('charset') == -1:
			charset = 'utf-8'

		webob.Request.__init__(self, environ, charset=charset,
			unicode_errors= 'ignore', decode_param_names=True)
		if self.headers.has_key("X-Forwarded-Host"):
			self.real_host_url = "%s://%s" % (self.headers.get("X-Forwarded-Proto", "http"), self.headers.get("X-Forwarded-Host"))
		else:
			self.real_host_url = self.host_url
		self.real_path_url = self.real_host_url + self.path
		if not self.content_type:
			self.content_type = content_type

	def get(self, argument_name, default_value='', allow_multiple=False):
		param_value = self.get_all(argument_name, default_value)
		if allow_multiple:
			return param_value
		else:
			if len(param_value) > 0:
				return param_value[0]
			else:
				return default_value

	def get_all(self, argument_name, default_value=''):
		if self.charset:
			argument_name = argument_name.encode(self.charset)

		try:
			param_value = self.params.getall(argument_name)
		except KeyError:
			return default_value

		for i in range(len(param_value)):
			if isinstance(param_value[i], cgi.FieldStorage):
				param_value[i] = param_value[i].value

		return param_value

	def formDict(self):
		vals = {}
		if self.GET:
			for k in self.GET:
				vals[k] = self.GET[k]
		if self.POST:
			for k in self.POST:
				vals[k] = self.POST[k]
		return vals

	def getUser(self):
		"""
		Get the user from this request object
		@return: User object, or None
		@rtype: User or None
		"""
		# We only want to TRY to 
		# authenticate them once, 
		# so we use "False" if they've
		# already been attempted to be authed, 
		# None if they haven't even been through 
		# this yet
		if self._user == None:
			try:
				self._user = False
				# Basic Authentication
				auth_header =  self.environ.get("HTTP_AUTHORIZATION")
				if auth_header:
					auth_type, encoded_info = auth_header.split(None, 1)
					if auth_type.lower() == "basic":
						unencoded_info = encoded_info.decode('base64')
						username, password = unencoded_info.split(':', 1)
						log.info("Looking up user: %s" % username)
						user = getCachedUser(username)
						if not user:
							try:
								user = User.find(username=username,deleted=False).next()
								addCachedUser(user)
							except:
								user = None
						if user and user.password == password:
							self._user = user
							return self._user
				# Cookie based Authentication Token
				auth_token_header = self.cookies.get("BW_AUTH_TOKEN")
				if auth_token_header:
					unencoded_info = auth_token_header
					if ':' in unencoded_info:
						username, auth_token = unencoded_info.split(':', 1)
						if username and auth_token:
							user = getCachedUser(username)
							if not user or not user.auth_token == unencoded_info:
								try:
									user = User.find(username=username,deleted=False).next()
									addCachedUser(user)
								except:
									user = None
							if user and user.auth_token == unencoded_info:
								self._user = user
								return self._user
				# JanRain Authentication token
				jr_auth_token = self.POST.get("token")
				if jr_auth_token:
					import urllib, urllib2, json, boto
					api_params = {
						"token": jr_auth_token,
						"apiKey": boto.config.get("JanRain", "api_key"),
						"format": "json"
					}
					http_response = urllib2.urlopen(boto.config.get("JanRain", "url"), urllib.urlencode(api_params))
					auth_info = json.loads(http_response.read())
					if auth_info['stat'] == "ok":
						profile = auth_info['profile']
						identifier = profile['identifier']
						email = profile.get("verifiedEmail")
						user = None

						# First we see if they have a Primary Key,
						# if so we use that to get the user
						primary_key = profile.get("primaryKey")
						if primary_key:
							user = User.get_by_id(primary_key)
							if user:
								boto.log.info("User '%s' logged in using PrimaryKey: %s" % (user, primary_key))

						# If that didn't work, check to see if they had an auth_token
						if not user:
							auth_token = self.GET.get("auth_token")
							if auth_token:
								try:
									user = User.find(auth_token=auth_token,deleted=False).next()
								except:
									user = None
								if user:
									# If we matched a user, set the OpenID
									# for that user to our identifier
									user.oid = identifier

						#  Try to get a user by OpenID identifier
						if not user:
							try:
								user = User.find(oid=identifier,deleted=False).next()
							except:
								user = None

						# If no OID match, try to match
						# via Email
						if not user and email:
							try:
								user = User.find(email=email,deleted=False).next()
							except:
								user = None

						if user:
							boto.log.info("Authenticated OID: %s as %s" % (identifier, user))
							self._user = user

							# Re-use an old auth-token if it's available
							from datetime import datetime, timedelta
							now = datetime.utcnow()
							if user.auth_token and (user.sys_modstamp - now) <= timedelta(hours=6) and user.auth_token.startswith(user.username):
								bw_auth_token = user.auth_token
							else:
								# Set up an Auth Token
								bw_auth_token = "%s:%s" % (user.username, jr_auth_token)
								user.auth_token = bw_auth_token
								user.put()
							self.cookies['BW_AUTH_TOKEN'] = bw_auth_token
							addCachedUser(user)
						else:
							boto.log.warn("Invalid OpenID: %s" % identifier)
							botoweb.report("Invalid OpenID: %s" % identifier, status=401, req=self, name="LoginFailure", priority=3)
					else:
						boto.log.warn("An error occured trying to authenticate the user: %s" % auth_info['err']['msg'])
						botoweb.report(auth_info['err']['msg'], status=500, req=self, name="LoginFailure", priority=1)
			except Exception, e:
				log.exception("Could not fetch user")

		# This False means we tried by there was no User
		# We always return None if there was no user
		# just for compatibility reasons
		if self._user == False:
			return None
		return self._user

	user = property(getUser, None, None)

	def get_base_url(self):
		return self.headers.get("X-Forwarded-URL", "")
	base_url = property(get_base_url, None, None)
