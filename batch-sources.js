$(function(){

  // Regex used for matching personIds
  var personIdReg = /[0-9A-Za-z]{4}\-[0-9A-Za-z]{3}/;
  
  var SOURCE_STATUS_NA = 0;
  var SOURCE_STATUS_SUCCESS = 1;
  var SOURCE_STATUS_FAIL = 2;

  // Get the FS configuration from the page
  var config = JSON.parse($('aside [data-config]').attr('data-config'));
  
  // Scrape the page for information about the main person in this record
  var personData = getPersonData();

  // Gather all links, starting with the current page
  var sourceLinks = [ 
    { 
      name: personData.givenName + ' ' + personData.familyName, 
      url: document.location.href 
    } 
  ];
  $('table.result-data a').each(function(){
    
    var link = $(this).attr('href');
    
    // Make sure the link points to a record
    if( link.indexOf('https://familysearch.org/pal:/') == 0 ) {
      sourceLinks.push({ name: $(this).text(), url: link });
    }
    
  });
  
  // Create confirmation dialog
  var confirmationDialogInner = $('<div>').addClass('modal-inner clearfix');
  $('<h2>').html('Sources Added to My Source Box').appendTo(confirmationDialogInner);
  $('<div id="batch-source-messages">').appendTo(confirmationDialogInner);
  $('<input type="button" class="form-submit" value="OK">').appendTo(confirmationDialogInner);
  $('<div id="batch-source-dialog-confirmation">').addClass('message-dialog')
    .append(confirmationDialogInner).wrap('<div style="display:none;">').parent().appendTo('#main');
  
  // Create batch add dialog
  var dialogInner = $('<div>').addClass('modal-inner clearfix');
  $('<h2>').html('Which sources do you want to add?').appendTo(dialogInner);
  
  // Setup the source selection list
  var sourceList = $('<table>').addClass('batch-source-list').appendTo(dialogInner);
  $.each(sourceLinks, function(i, s){
    var row = $('<tr>').appendTo(sourceList);
    
    // Create cell that contains checkbox and person name
    $('<label>').append( $('<input type="checkbox" value="' + i + '" CHECKED >').addClass('batch-source-checkbox') )
      .append( $('<span>').html( s.name ) )
      .appendTo( $('<td>').appendTo(row) );
      
    // Create cell that contains input field for person ID
    $('<td>').appendTo(row).append( $('<input id="source-attach-' + i + '" type="text">').addClass('batch-source-person-id') );
  });
  
  // Add toggle-all links
  $('<a href="#">All</a>').css('margin-right', '10px').click(function(){
    $('.batch-source-checkbox').attr('checked', true);
  }).appendTo(dialogInner);
  $('<a href="#">None</a>').css('margin-right', '10px').click(function(){
    $('.batch-source-checkbox').attr('checked', false);
  }).appendTo(dialogInner);
  
  // Create add button and click event handler
  $('<button>').addClass('form-submit').html('Add Sources').css('float', 'right').click(function(){
    
    // Gather list of sources to add
    var requestedSources = [];
    $('.batch-source-checkbox:checked').each(function(){
      // The value of the checkboxes is the index of the
      // object in the soruceLinks array
      var sourceIndex = $(this).val();
      var source = sourceLinks[sourceIndex];
      
      // Add a personId if the user requested that the
      // source also be attached to a person
      var personId = $('#source-attach-' + sourceIndex).val().toUpperCase();
      if( personIdReg.test( personId ) ) {
        source.personId = personId;
      }
      
      requestedSources.push( source );
    });
    
    // Clear out any old messages
    $('#batch-source-messages').html('');
    
    // Save the sources
    batchSourceSave(requestedSources).always(function(){
      
      // Dispay the confirmation box with messages
      $.fancybox({ href: '#batch-source-dialog-confirmation',  padding: 0, overlayColor: '#fff' });
      
    });
    
  }).appendTo(dialogInner);
  
  // Add the batch dialog to the page
  $('<div id="batch-source-dialog">').addClass('source-dialog modal fade hide')
    .append(dialogInner).wrap('<div style="display:none;">').parent().appendTo('#wrapper');
  
  // Add the batch add button to the toolbar
  $('.source-menu li:nth-child(1)').after(
    $('<li>').append(
      $('<a href="#">BATCH SOURCE ADD</a>').click(function(){
        $.fancybox({ href: '#batch-source-dialog',  padding: 0, overlayColor: '#fff' });
      })
    )
  );
  
  function addMessage(message) {
    $('#batch-source-messages').append( $('<div>').addClass('batch-source-message').html(message) );
  }
  
  function batchSourceSave(sources) {
    
    var deferreds = [];
    
    $.each(sources, function(i, source){
      
      var createDeferred = $.ajax({
        type: 'POST',
        url: '/links/source?sessionId=' + config.sessionId,
        dataType: 'json',
        data: '{ "uri" : { "uri" : "' +  source.url + '" }, "sourceType" : "FSREADONLY"}',
        processData: false,
        contentType: "application/json",
        accept: 'application/json; charset=utf8'
      }).done(function(){
        if( !source.personId ) {
          addMessage( 'A source was created for ' + source.name + '.' );
        }
      }).fail(function(){
        addMessage( 'We failed to create the source for ' + source.name + '.' );
      });
      
      // If the source should be attached to a person,
      // add the success handler which will do that
      if( source.personId ) {
        createDeferred.done(function(json){
          deferreds.push( 
            attachSource(json.id, source.personId).done(function(){
              addMessage( 'A source was created and attached for ' + source.name + '.' );
            }).fail(function(){
              addMessage( 'A source was created for ' + source.name + ' but we failed to attach it.' );
            })
          );
        });
      }
      
      deferreds.push( createDeferred );
      
    });
    
    return $.when.apply(deferreds);
    
  };
  
  function attachSource(sourceId, personId) {
    return $.ajax({
      type: 'POST',
      url: '/ct/persons/' + personId + '/source-references/source-reference?mediaType=application/json',
      dataType: 'json',
      data: '{"id":null, "conclusionTypes":[], "contribution":{"timeStamp":null, "contributorId":null, "submitterId":null}, "entityId":"' + personId + '", "justification":{"reason":"", "confidence":null}, "sourceReferenceType":null, "sourceUri":"' + sourceId + '"}',
      processData: false,
      contentType: "application/json",
      accept: 'application/json; charset=utf8'
    });
  };

});

function getPersonData(){
  
  var hasFamilyTable = $('.result-data .household-label').length > 0;
    
  // Process the table rows of the record data
  // The first cell in each row becomes the key
  // The second cell becomes a list of the cells in that row
  // We store all the cells because the gender of
  // family members on census records is important
  var recordData = {};
  $('.result-data tr').each(function(){
    var row = $(this);
    var fieldName = $.trim( $('td:first', row).text().toLowerCase().slice(0, -1) );
    if( fieldName ) {
      recordData[fieldName] = $('td', row);
    }
  });
  
  var nameParts = ['',''];
  if( recordData['first name'] ) {
    nameParts = [ getCleanCellValue( recordData['first name'], 1 ) , getCleanCellValue( recordData['last name'], 1 ) ];
  } 
  else if(recordData['name']) {
    nameParts = splitName( getCleanCellValue( recordData['name'], 1 ) );
  }
  
  var personData = {
    'givenName': nameParts[0],
    'familyName': nameParts[1],
    'birthDate': checkMultipleFields( recordData, ['birth date', 'birthdate', 'estimated birth year', 'estimated birth date', 'baptism/christening date'], 1 ),
    'birthPlace': checkMultipleFields( recordData, ['birthplace', 'place of birth'], 1 ),
    'deathDate': getCleanCellValue( recordData['death date'], 1 ),
    'deathPlace': getCleanCellValue( recordData['death place'], 1 )
  };
  
  // Look for a spouse
  var spouseName = getSpousesName(recordData);
  if( spouseName ) {
    var spouseNameParts = splitName( spouseName );
    personData['spouseGivenName'] = spouseNameParts[0];
    personData['spouseFamilyName'] = spouseNameParts[1];
  }
  
  // Look for a mother
  var motherName = getParentName(recordData, 'mother');
  if( motherName ) {
    var motherNameParts = splitName( motherName );
    personData['motherGivenName'] = motherNameParts[0];
    personData['motherFamilyName'] = motherNameParts[1];
  }

  // Look for a father
  var fatherName = getParentName(recordData, 'father');
  if( fatherName ) {
    var fatherNameParts = splitName( fatherName );
    personData['fatherGivenName'] = fatherNameParts[0];
    personData['fatherFamilyName'] = motherNameParts[1];
  }
  
  return personData;
  
  // Check for the existence of multiple fields
  // First one found is returned
  function checkMultipleFields( recordData, fields, position ) {
    for( var i in fields ) {
      if( recordData[fields[i]] ) {
        var val = getCleanCellValue( recordData[fields[i]], position );
        if( val ) {
          return val;
        }
      }
    }
    return '';
  };
  
  function getCleanCellValue( cells, position ) {
    if( cells ) {
      return $.trim( cells.eq(position).text() );
    }
    return undefined;
  };
  
  function getRelationship(recordData) {
    return checkMultipleFields( recordData, ["relationship to head of household", "relationship to head of household (standardized)"], 1 ).toLowerCase();
  };
  
  function getSpousesName(recordData) {
    // Check to see if the "spouse's name" is set
    if( recordData["spouse's name"] ) {
      return getCleanCellValue( recordData["spouse's name"], 1 );
    }
    
    // If "spouse's name" isn't set do some crazy relationship jiu-jitsu
    else if( hasFamilyTable ) {
      var relationship = getRelationship(recordData);
      
      // The husband is always listed as the head of household
      // so we only look for the wife. If the wife is the head
      // of household it means the husband isn't there so returning
      // the wife will be undefined which means there is no spouse
      if( relationship == "head" || relationship == "self" ) {
        return getCleanCellValue( recordData['wife'], 1 );
      } else if( relationship == "wife" ) {
        return checkMultipleFields( recordData, ['head', 'self'], 1 );
      }
    }
    
    return undefined;
  };

  function getParentName(recordData, parent) {
    // Check to see if the "parent's name" is set
    if( recordData[parent+"'s name"] ) {
      return getCleanCellValue( recordData[parent+"'s name"], 1);
    }
    
    // If "parent's name" isn't set do some crazy relationship jiu-jitsu
    else if( hasFamilyTable ) {
      var relationship = getRelationship(recordData);
      
      if( relationship == 'son' || relationship == 'daughter' ) {
        var headGender = checkMultipleFields( recordData, ['head', 'self'], 2 );
        
        if( parent == 'father' ) {
          
          // Check to see if the gender of the head of household is male
          if( headGender == 'M' ) {
            return checkMultipleFields( recordData, ['head', 'self'], 1 );
          }
        } else if( parent == 'mother' ) {
          
          // If the head of household is male, return the wife's name
          // If the head of household is female, return the head's name
          if( headGender == 'F' ) {
            return checkMultipleFields( recordData, ['head', 'self'], 1 );
          } else if( headGender == 'M' ) {
            return getCleanCellValue( recordData['wife'], 1);
          }
        }
      }
    }
    
    return undefined;
  };
  
  function splitName(name) {
    if( name ) {    
      return name.split(/\s+(?=\S*$)/);
    } else {
      return ['',''];
    }
  };

};