import http.server
import socketserver
from  os import path

my_host = 'localhost'
port = 8888
folder = pwd()
homepage = 'index.html'

class Request(http.server.SimpleHTTPRequestHandler):

   def _set_header(self):
      self.send_response(200)
      self.send_header('Content-Type', 'text/html)
      self.send_header('Content-Lengt', path.getsize(self.getPath()))
      self.end_headers

   def getPath(self)
      content_path = path.join(
		folder, homepage)

