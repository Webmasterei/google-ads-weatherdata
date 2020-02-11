// Register for an API key at http://openweathermap.org/appid
// and enter the key below.
var OPEN_WEATHER_MAP_API_KEY = 'INSERT_OPEN_WEATHER_MAP_API_KEY_HERE';
var SPREADSHEET_URL = 'INSERT_SPREADSHEET_URL_HERE';

// A cache to store the weather for locations already lookedup earlier.
var WEATHER_LOOKUP_CACHE = {};

var MODE = "FORECAST" // Following Modes are possible: CURRENT or FORECAST (this one should - one day serve min/max for the day)
// TODO Make ForeCast Calls and analysis;
var SEARCHMODE = "ZIP" // Possible Queries are ZIP or NAME;
var LOCATION_UPDATE = 1; // Number of hours, weatherdata expires
var APILIMIT = 60; // Number of API calls in one chunk.
var timeOutInSeconds = 60; // Seconds of timeout between chunks
var DEBUG = 0;

  var spreadsheet = validateAndGetSpreadsheet(SPREADSHEET_URL);
  var now = new Date();
var timeZone = AdsApp.currentAccount().getTimeZone();


/**
 * The code to execute when running the script.
 */
function main() {
  validateApiKey();
  // Load data from spreadsheet.
  var locationsData = getSheetData(spreadsheet, 0)

  var locationsPreparedData = prepareLocationData(locationsData);
  
  var weatherData = iterateLocations(locationsPreparedData);
  

}


function prepareLocationData(data){
  var objects = []
  data.forEach(function(row, index){
      var lastUpdate = row[11];
    if(!lastUpdate){
      lastUpdate = 0;
    }
    if(index){
    objects.push({
      targetLocation: row[2],
      country: row[4],
      id: row[1].toString(),
      lastUpdate: lastUpdate
    });
    }
  })
  return objects;
}


function iterateLocations(locationsData){
  // Remove Previously Updated Data LOCATION_UPDATE sets the hours for that.
  var locationsData = locationsData.filter(function(location){
     if(MODE=="FORECAST"){
       var dateOfLastUpdate = Utilities.formatDate(location.lastUpdate, timeZone, 'd');
       var today = Utilities.formatDate(now, timeZone, 'd');
     } else {
          return new Date(location.lastUpdate).getTime() < now.getTime() - LOCATION_UPDATE * 36000;
        }
  });
  var weatherdata = [];
  var locationsDataChunks = chunkArray(locationsData, APILIMIT);
  locationsDataChunks.forEach(function(chunk, index){
    if(index>0){
         Utilities.sleep(timeOutInSeconds * 1000)
       }
      chunk.forEach(function(location, index){
        var response = getWeather(location);
        if(MODE=="FORECAST"){
          var todayForecast = prepareForecast(response, location);
          
        } else {
        location.weather = response.weather[0].main;
        location.wind = response.wind.speed;
        location.temp_min = Math.round(response.main.temp_min);
        location.temp = Math.round(response.main.temp);
        location.temp_max = Math.round(response.main.temp_max);
        location.url = response.url;
        location.name = response.city.name;
        }
        weatherdata.push(location)
      });
    saveWeather(weatherdata,spreadsheet, 0);
    index = index + 1;
  });
}


function saveWeather(weatherdata, spreadsheet, sheetIndex) {
  var now = new Date();
  var sheet = spreadsheet.getSheets()[sheetIndex];
  var values = [];
  
  // TODO Make this smart so it searches for the right criteria to update
  
  weatherdata.forEach(function(item){
      var criteriaRow = onSearch(item.id, 1);
      var range = sheet.getRange(criteriaRow , 7, 1,  7);
      //weatherdata.forEach(function(row,index){
        var rowData = [[item.weather, item.wind, item.temp_min, item.temp_max, item.name, now, item.url]]
        range.setValues(rowData);

  //});
  });
}

function prepareForecast(response, location){
          var temperatures = []
          var wind = []
          var weather = []
          var forecastList = []
          // Filter List on Today only
          if(response.list){
          var forecastList = response.list.filter(function(timespan){
            now = Utilities.formatDate(new Date(), timeZone, 'd');
            var forecastTime = new Date(timespan.dt * 1000);   
            forecastTime = Utilities.formatDate(forecastTime, timeZone, 'd');
            return now == forecastTime;
          })
          }
          if(!forecastList.length){
             throw 'No Forecast found';
            }

          forecastList.forEach(function(item){
            temperatures.push(item.main.temp);
            wind.push(item.wind.speed);
            weather.push(item.weather[0]);
          });
          weather = weather.sort(function(a, b) { return parseFloat(a.id) - parseFloat(b.id); });
          temperatures = temperatures.sort(function(a,b) { return a - b;});
          wind = wind.sort(function(a,b) { return a - b;});
          location.weather = weather[weather.length - 1].main;
          location.wind = wind[wind.length - 1];
          location.temp_min = Math.round(temperatures[0]);
          location.temp = '';
          location.temp_max = Math.round(temperatures[temperatures.length - 1]);
          location.name = response.city.name;
          location.url = response.url;
          return location
};

/**
 * Retrieves the weather for a given location, using the OpenWeatherMap API.
 *
 * @param {string} location The location to get the weather for.
 * @return {Object.<string, string>} The weather attributes and values, as
 *     defined in the API.
 */
function getWeather(location) {
  if (location in WEATHER_LOOKUP_CACHE) {
    Logger.log('Cache hit...');
    return WEATHER_LOOKUP_CACHE[location.targetLocation];
  }
  if(MODE=="FORECAST"){
    var mode = "forecast";
  } else {
    var mode = "current";
  }
  if(SEARCHMODE=="ZIP"){
    var queryParam = "zip"
    var locQuery = location.targetLocation.split(',');
    location = locQuery[0] + ',' + location.country;
    var fallbackLocation = locQuery[1] + ',' + location.country;
    
    // location.targetLocation, location.country
    
  } else {
    var queryParam = "q";
  }
  
  var url = 'http://api.openweathermap.org/data/2.5/' + mode + '?APPID=' + OPEN_WEATHER_MAP_API_KEY + '&' + queryParam + '=' + location + '&units=metric';
  var fallbackUrl = 'http://api.openweathermap.org/data/2.5/' + mode + '?APPID=' + OPEN_WEATHER_MAP_API_KEY + '&q=' + fallbackLocation + '&units=metric';
  
  var response = UrlFetchApp.fetch(url,{muteHttpExceptions: true});
  // Repeat if location could not be resolved
  var responseText = JSON.parse(response.getContentText());
  
  if (responseText.message === "city not found"){
    url = fallbackUrl;
    var response = UrlFetchApp.fetch(url,{muteHttpExceptions: true});
  } 
  if (response.getResponseCode() != 200) {
     Logger.log(url);
    Logger.log('Error returned by API: '+response.getContentText()+',  Location searched: '+location+'.');
    //throw Utilities.formatString(
    //    'Error returned by API: %s, Location searched: %s.',
    //    response.getContentText(), location);
  }

  var result = JSON.parse(response.getContentText());
  // OpenWeatherMap's way of returning errors.
  if (result.cod != 200) {
    throw Utilities.formatString(
        'Error returned by API: %s,  Location searched: %s.',
        response.getContentText(), location);
  }
  if(DEBUG){
    result.url = url;
  } else {
    result.url ="";
  }
  WEATHER_LOOKUP_CACHE[location] = result;
  return result;
}
/**
 * DO NOT EDIT ANYTHING BELOW THIS LINE.
 * Please modify your spreadsheet URL and API key at the top of the file only.
 */

/**
 * Validates the provided spreadsheet URL to make sure that it's set up
 * properly. Throws a descriptive error message if validation fails.
 *
 * @param {string} spreadsheeturl The URL of the spreadsheet to open.
 * @return {Spreadsheet} The spreadsheet object itself, fetched from the URL.
 * @throws {Error} If the spreadsheet URL hasn't been set
 */
function validateAndGetSpreadsheet(spreadsheeturl) {
  if (spreadsheeturl == 'INSERT_SPREADSHEET_URL_HERE') {
    throw new Error('Please specify a valid Spreadsheet URL. You can find' +
        ' a link to a template in the associated guide for this script.');
  }
  var spreadsheet = SpreadsheetApp.openByUrl(spreadsheeturl);
  return spreadsheet;
}



/**
 * Retrieves the data for a worksheet.
 *
 * @param {Object} spreadsheet The spreadsheet.
 * @param {number} sheetIndex The sheet index.
 * @return {Array} The data as a two dimensional array.
 */
function getSheetData(spreadsheet, sheetIndex) {
  var sheet = spreadsheet.getSheets()[sheetIndex];
  var range =
      sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn());
  return range.getValues();
}

/**
 * Builds a mapping between the list of campaigns and the rules
 * being applied to them.
 *
 * @param {Array} campaignRulesData The campaign rules data, from the
 *     spreadsheet.
 * @return {Object.<string, Array.<Object>> } A map, with key as campaign name,
 *     and value as an array of rules that apply to this campaign.
 */
/**
 * Validates the provided API key to make sure that it's not the default. Throws
 * a descriptive error message if validation fails.
 *
 * @throws {Error} If the configured API key hasn't been set.
 */
function validateApiKey() {
  if (OPEN_WEATHER_MAP_API_KEY == 'INSERT_OPEN_WEATHER_MAP_API_KEY_HERE') {
    throw new Error('Please specify a valid API key for OpenWeatherMap. You ' +
        'can acquire one here: http://openweathermap.org/appid');
  }
}



function chunkArray(myArray, chunk_size){
    var index = 0;
    var arrayLength = myArray.length;
    var tempArray = [];
    
    for (index = 0; index < arrayLength; index += chunk_size) {
        myChunk = myArray.slice(index, index+chunk_size);
        // Do something if you want with the group
        tempArray.push(myChunk);
    }

    return tempArray;
}


function onSearch(searchString, column)
{
    var sheet = spreadsheet.getSheets()[0];
    var column = 2; //column Index   
    var range = sheet.getRange(2, column, sheet.getLastRow()).getValues(); //1st is header row
    var searchResult = range.findIndex(searchString); //Row Index - 2
    if(searchResult != -1)
    {
        //searchResult + 2 is row index.
        var rowIndex = searchResult + 2;
      return rowIndex;
    }
  
}

Array.prototype.findIndex = function(search){
  if(search == "") return false;
  for (var i=0; i<this.length; i++)
    if (this[i] == search) return i;

  return -1;
} 
