#
# Copyright (C) 2009 Chris Moyer http://coredumped.org/
# 
import sys
sys.path.append(".")

class TestBase(object):
    """
    Testing base class, this provides some 
    simple shared functionality for all
    classes to use.

    This emulates what would actually happen if
    you connected via the HTTP server without actually
    running the HTTP server.
    """
    application="boto_web"

    def setup_class(cls):
        """
        Setup this class to handle testing
        """
        from boto_web.appserver.url_mapper import URLMapper
        from boto_web.appserver.filter_mapper import FilterMapper
        from boto_web.appserver.auth_layer import AuthLayer

        from boto_web.environment import Environment
        e = Environment(cls.application)

        cls.mapper = AuthLayer( app=FilterMapper( app=URLMapper(e), env=e), env=e)

    def teardown_class(cls):
        """
        Cleanup after our tests
        """


    def make_request(self, resource, method="GET", body=None, params={}):
        """
        Make a request to a given resource

        @param resource: The resource URI to fetch from (ex. /users)
        @type resource: str

        @param method: The HTTP/1.1 Method to use, (GET/PUT/DELETE/POST/HEAD)
        @type method: str

        @param body: Optional body text to send
        @type body: str

        @param params: Optional additional GET/POST parameters to send (GET if GET, POST if POST)
        @type params: dict
        """
        from boto_web.request import Request
        from boto_web.response import Response
        import urllib

        query_params = []
        for (k, v) in params:
            query_params.append("%s=%s" % (k, urllib.quote_plus(v)))

        if method == "POST":
            req = Request.blank(resource)
            if query_params:
                body = "&".join(query_params)
                req.environ['CONTENT_TYPE'] = 'application/x-www-form-urlencoded'
        else:
            if query_params:
                resource = "%s?%s" % (resource, "&".join(query_params))
            req = Request.blank(resource)

        if body:
            req.body = body
            req.environ['CONTENT_LENGTH'] = str(len(req.body))

        req.method = method

        if self.user:
            req._user = self.user

        from pprint import pprint
        pprint(req.GET)
        return self.mapper.handle(req, Response())